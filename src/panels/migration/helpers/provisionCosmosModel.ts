/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import {
    PartitionKeyDefinitionVersion,
    PartitionKeyKind,
    type ContainerDefinition,
    type CosmosClient,
    type IndexingPolicy as CosmosIndexingPolicy,
} from '@azure/cosmos';
import { type CancellationToken } from 'vscode';
import { type CosmosModel, type IndexingPolicy } from '../cosmosModel';

type ProvisioningContainer = Pick<ContainerDefinition, 'partitionKey' | 'indexingPolicy'> & { id: string };

export interface CosmosModelProvisioningOperations {
    createDatabase(databaseName: string): Promise<unknown>;
    createContainer(databaseName: string, definition: ProvisioningContainer, maxThroughput?: number): Promise<unknown>;
}

interface ProvisioningOptions {
    createDatabase?: boolean;
    token?: CancellationToken;
    onProgress?: (resource: 'database' | 'container', name: string) => void | Promise<void>;
}

/** Shared resource phase for migration and modeling. It neither generates sample data nor emits telemetry. */
export async function provisionCosmosModel(
    model: CosmosModel,
    databaseName: string,
    operations: CosmosModelProvisioningOperations,
    options: ProvisioningOptions = {},
): Promise<string[] | undefined> {
    if (options.token?.isCancellationRequested) return undefined;
    if (options.createDatabase !== false) {
        await options.onProgress?.('database', databaseName);
        if (options.token?.isCancellationRequested) return undefined;
        await operations.createDatabase(databaseName);
    }
    const created: string[] = [];
    for (const container of model.containers) {
        if (options.token?.isCancellationRequested) return undefined;
        await options.onProgress?.('container', container.name);
        if (options.token?.isCancellationRequested) return undefined;
        const paths = container.partitionKeys?.map((key) => key.path) ?? ['/id'];
        await operations.createContainer(
            databaseName,
            {
                id: container.name,
                partitionKey: {
                    paths,
                    kind: paths.length > 1 ? PartitionKeyKind.MultiHash : PartitionKeyKind.Hash,
                    version: PartitionKeyDefinitionVersion.V2,
                },
                indexingPolicy: container.indexingPolicy ? toIndexingPolicy(container.indexingPolicy) : undefined,
            },
            model.capacityMode === 'provisioned' && container.maxThroughput ? container.maxThroughput : undefined,
        );
        created.push(container.name);
    }
    return created;
}

export function armProvisioningOperations(
    client: CosmosDBManagementClient,
    target: { resourceGroup: string; accountName: string },
): CosmosModelProvisioningOperations {
    return {
        createDatabase: (databaseName) =>
            client.sqlResources.beginCreateUpdateSqlDatabaseAndWait(
                target.resourceGroup,
                target.accountName,
                databaseName,
                {
                    resource: { id: databaseName },
                    options: {},
                },
            ),
        createContainer: (databaseName, definition, maxThroughput) =>
            client.sqlResources.beginCreateUpdateSqlContainerAndWait(
                target.resourceGroup,
                target.accountName,
                databaseName,
                definition.id,
                {
                    resource: definition,
                    options: maxThroughput ? { autoscaleSettings: { maxThroughput } } : {},
                },
            ),
    };
}

export function sdkProvisioningOperations(client: CosmosClient): CosmosModelProvisioningOperations {
    return {
        createDatabase: (databaseName) => client.databases.createIfNotExists({ id: databaseName }),
        createContainer: (databaseName, definition, maxThroughput) =>
            client.database(databaseName).containers.createIfNotExists({ ...definition, maxThroughput }),
    };
}

function toIndexingPolicy(policy: IndexingPolicy): CosmosIndexingPolicy {
    // A wildcard is terminal-only in Cosmos DB paths; array traversal uses [].
    const sanitize = (paths: { path: string }[]) =>
        paths.map(({ path }) => ({ path: path.replace(/\/\*\//g, '/[]/') }));
    return {
        indexingMode: (policy.indexingMode ?? 'consistent') as CosmosIndexingPolicy['indexingMode'],
        automatic: policy.automatic ?? true,
        includedPaths: sanitize(policy.includedPaths),
        excludedPaths: sanitize(policy.excludedPaths),
        compositeIndexes: policy.compositeIndexes,
    };
}
