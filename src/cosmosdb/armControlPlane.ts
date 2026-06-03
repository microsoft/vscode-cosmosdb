/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type CosmosDBManagementClient,
    type SqlContainerCreateUpdateParameters,
    type ThroughputSettingsGetResults,
} from '@azure/arm-cosmosdb';
import { PartitionKeyDefinitionVersion, PartitionKeyKind, type ContainerDefinition } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { createCosmosDBManagementClient } from '../utils/azureClients';

/**
 * Minimal ARM-based control-plane shim for issue #2990 (rel/0.34 backport).
 *
 * Accounts configured with strict native data-plane RBAC reject control-plane
 * operations issued via the data-plane `CosmosClient`. For Azure-signed-in
 * accounts we have enough context to instead route those operations through
 * ARM, which the role does not block. The full control-plane abstraction from
 * `main` (#3016) is intentionally not backported — only the surface needed to
 * unblock create/delete database & container and offer reads.
 *
 * Emulator and workspace-attached connection-string accounts continue to use
 * the data-plane `CosmosClient` because ARM is not reachable for them.
 */

export interface ArmAccountContext {
    subscription: AzureSubscription;
    resourceGroup: string;
    accountName: string;
}

export function getArmAccountContext(accountInfo: AccountInfo): ArmAccountContext | undefined {
    if (accountInfo.isEmulator || !accountInfo.subscription || !accountInfo.resourceGroup) {
        return undefined;
    }
    return {
        subscription: accountInfo.subscription,
        resourceGroup: accountInfo.resourceGroup,
        accountName: accountInfo.name,
    };
}

async function getArmClient(ctx: ArmAccountContext): Promise<CosmosDBManagementClient> {
    const client = await callWithTelemetryAndErrorHandling(
        'createCosmosDBManagementClient',
        async (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            context.valuesToMask.push(ctx.subscription.subscriptionId);
            return createCosmosDBManagementClient(context, ctx.subscription);
        },
    );
    if (!client) {
        throw new Error(l10n.t('Failed to connect to Cosmos DB account'));
    }
    return client;
}

export async function armCreateDatabase(ctx: ArmAccountContext, databaseId: string): Promise<void> {
    const client = await getArmClient(ctx);
    await client.sqlResources.beginCreateUpdateSqlDatabaseAndWait(ctx.resourceGroup, ctx.accountName, databaseId, {
        resource: { id: databaseId },
        options: {},
    });
}

export async function armDeleteDatabase(ctx: ArmAccountContext, databaseId: string): Promise<void> {
    const client = await getArmClient(ctx);
    await client.sqlResources.beginDeleteSqlDatabaseAndWait(ctx.resourceGroup, ctx.accountName, databaseId);
}

export async function armCreateContainer(
    ctx: ArmAccountContext,
    databaseId: string,
    definition: ContainerDefinition,
    throughput?: number,
): Promise<void> {
    const containerId = definition.id!;
    const partitionKeyPaths = definition.partitionKey?.paths ?? [];
    const kind = getPartitionKeyKind(definition.partitionKey?.kind, partitionKeyPaths.length);
    const version = definition.partitionKey?.version ?? PartitionKeyDefinitionVersion.V2;

    const parameters: SqlContainerCreateUpdateParameters = {
        resource: {
            id: containerId,
            partitionKey: {
                paths: partitionKeyPaths,
                kind,
                version,
            },
            indexingPolicy:
                definition.indexingPolicy as SqlContainerCreateUpdateParameters['resource']['indexingPolicy'],
            defaultTtl: definition.defaultTtl,
            uniqueKeyPolicy:
                definition.uniqueKeyPolicy as SqlContainerCreateUpdateParameters['resource']['uniqueKeyPolicy'],
            conflictResolutionPolicy:
                definition.conflictResolutionPolicy as SqlContainerCreateUpdateParameters['resource']['conflictResolutionPolicy'],
        },
        options: throughput !== undefined && throughput !== 0 ? { throughput } : {},
    };

    const client = await getArmClient(ctx);
    await client.sqlResources.beginCreateUpdateSqlContainerAndWait(
        ctx.resourceGroup,
        ctx.accountName,
        databaseId,
        containerId,
        parameters,
    );
}

export async function armDeleteContainer(
    ctx: ArmAccountContext,
    databaseId: string,
    containerId: string,
): Promise<void> {
    const client = await getArmClient(ctx);
    await client.sqlResources.beginDeleteSqlContainerAndWait(
        ctx.resourceGroup,
        ctx.accountName,
        databaseId,
        containerId,
    );
}

export async function armReadDatabaseThroughput(
    ctx: ArmAccountContext,
    databaseId: string,
): Promise<ThroughputSettingsGetResults | undefined> {
    const client = await getArmClient(ctx);
    try {
        return await client.sqlResources.getSqlDatabaseThroughput(ctx.resourceGroup, ctx.accountName, databaseId);
    } catch (err) {
        if (isNotFound(err)) {
            return undefined;
        }
        throw err;
    }
}

export async function armReadContainerThroughput(
    ctx: ArmAccountContext,
    databaseId: string,
    containerId: string,
): Promise<ThroughputSettingsGetResults | undefined> {
    const client = await getArmClient(ctx);
    try {
        return await client.sqlResources.getSqlContainerThroughput(
            ctx.resourceGroup,
            ctx.accountName,
            databaseId,
            containerId,
        );
    } catch (err) {
        if (!isNotFound(err)) {
            throw err;
        }
    }
    // Container may inherit throughput from a shared-throughput database.
    return armReadDatabaseThroughput(ctx, databaseId);
}

function isNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
        return false;
    }
    const e = err as { statusCode?: number; code?: string | number };
    return e.statusCode === 404 || e.code === 404 || e.code === 'NotFound' || e.code === 'ResourceNotFound';
}

/**
 * Selects the partition-key kind for a new container, fixing the operator-
 * precedence bug in the previous expression
 * `(kind ?? paths.length > 1) ? MultiHash : Hash`, which short-circuited on
 * the truthy `'Hash'` string and incorrectly produced `MultiHash` whenever
 * `kind` was explicitly `Hash`. Compare to `MultiHash` and only fall back to
 * the path-count heuristic when `kind` is undefined.
 *
 * Shared between the ARM (`armCreateContainer`) and data-plane
 * (`createContainer/CosmosDBExecuteStep`) paths so the two cannot drift.
 */
export function getPartitionKeyKind(kind: PartitionKeyKind | undefined, pathCount: number): PartitionKeyKind {
    if (kind === PartitionKeyKind.MultiHash) {
        return PartitionKeyKind.MultiHash;
    }
    if (kind === undefined && pathCount > 1) {
        return PartitionKeyKind.MultiHash;
    }
    return PartitionKeyKind.Hash;
}
