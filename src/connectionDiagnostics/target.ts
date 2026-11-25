/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { type AzureResourceMetadata } from '../cosmosdb/AzureResourceMetadata';
import { parseCosmosDBConnectionString } from '../cosmosdb/cosmosDBConnectionStrings';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type CosmosDBAccountModel } from '../tree/cosmosdb/models/CosmosDBAccountModel';
import { type CosmosDBAttachedAccountModel } from '../tree/workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { type CheckResult, type NetworkSummary } from './model';
import { withStepTimeout } from './stepTimeout';

export type AccountDiagnosticsTarget = (
    | { kind: 'azure'; account: CosmosDBAccountModel }
    | { kind: 'attached' | 'emulator'; account: CosmosDBAttachedAccountModel }
) & { probe: 'nosql' | 'network' };
export type DiagnosticsTarget =
    | AccountDiagnosticsTarget
    | { kind: 'queryEditor'; probe: 'query'; connection: NoSqlQueryConnection };

export type DiagnosticsAzureAccount = Pick<CosmosDBAccountModel, 'id' | 'name' | 'resourceGroup' | 'subscription'>;
export type DiagnosticsArmAccount = Pick<AzureResourceMetadata, 'getClient' | 'resourceGroup' | 'databaseAccount'>;

export function getDiagnosticsAzureAccount(target: DiagnosticsTarget): DiagnosticsAzureAccount | undefined {
    if (target.kind === 'azure') return target.account;
    const metadata =
        target.kind === 'queryEditor' && !target.connection.isEmulator ? target.connection.azureMetadata : undefined;
    return (
        metadata && {
            id: metadata.accountId,
            name: metadata.accountName,
            resourceGroup: metadata.resourceGroup,
            subscription: metadata.subscription,
        }
    );
}

export function getConnectionDetails(target: DiagnosticsTarget): {
    endpoint?: string;
    key?: string;
    tenantId?: string;
} {
    if (target.kind === 'queryEditor') return { endpoint: target.connection.endpoint };
    if (target.kind === 'azure') {
        const rawEndpoint: unknown = target.account.raw?.properties?.documentEndpoint;
        return {
            endpoint: typeof rawEndpoint === 'string' ? rawEndpoint : undefined,
            tenantId: target.account.subscription.tenantId,
        };
    }
    try {
        const parsed = parseCosmosDBConnectionString(target.account.connectionString);
        return {
            endpoint: parsed.documentEndpoint,
            key: parsed.masterKey,
            tenantId: target.account.tenantId ?? parsed.tenantId,
        };
    } catch {
        // Endpoint validation reports malformed saved connections without exposing their input.
        return {};
    }
}

export function validEndpoint(value: unknown, emulator: boolean): URL | undefined {
    if (typeof value !== 'string') return undefined;
    const url = URL.parse(value);
    if (
        !url ||
        (url.protocol !== 'https:' && !(emulator && url.protocol === 'http:')) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
    ) {
        return undefined;
    }
    return url;
}

export async function checkAccountSettings(
    account: DiagnosticsAzureAccount,
    signal: AbortSignal,
): Promise<{ arm?: DiagnosticsArmAccount; result: CheckResult }> {
    try {
        const arm = await withStepTimeout(signal, 6_000, (stepSignal) => readArmAccount(account, stepSignal));
        if (arm) {
            return {
                arm,
                result: {
                    step: 'accountSettings',
                    finding: 'settingsRead',
                    status: 'passed',
                    network: summarizeNetwork(arm.databaseAccount),
                },
            };
        }
    } catch {
        signal.throwIfAborted();
    }
    return { result: { step: 'accountSettings', finding: 'settingsUnavailable', status: 'info' } };
}

function summarizeNetwork(account: DatabaseAccountGetResults): NetworkSummary {
    const mode = account.publicNetworkAccess;
    return {
        publicAccess:
            mode === 'Enabled'
                ? 'enabled'
                : mode === 'Disabled'
                  ? 'disabled'
                  : mode === 'SecuredByPerimeter'
                    ? 'securedByPerimeter'
                    : 'unknown',
        ipRules: account.ipRules?.length ?? 0,
        vnetFilterEnabled: account.isVirtualNetworkFilterEnabled === true,
        vnetRules: account.virtualNetworkRules?.length ?? 0,
        privateEndpoints: account.privateEndpointConnections?.length ?? 0,
        localAuthDisabled: account.disableLocalAuth === true,
    };
}

async function readArmAccount(account: DiagnosticsAzureAccount, signal: AbortSignal) {
    return callWithTelemetryAndErrorHandling('cosmosDB.diagnostics.readAccount', async (context) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.maskEntireErrorMessage = true;
        context.telemetry.suppressIfSuccessful = true;
        const group = account.resourceGroup;
        if (!group) return undefined;
        context.valuesToMask.push(account.id, account.name, group, account.subscription.subscriptionId);
        const client = await createCosmosDBManagementClient(context, account.subscription);
        signal.throwIfAborted();
        const resource = await client.databaseAccounts.get(group, account.name, { abortSignal: signal });
        return { databaseAccount: resource, resourceGroup: group, getClient: async () => client };
    });
}
