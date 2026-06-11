/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type CosmosDBManagementClient,
    type SqlContainerCreateUpdateParameters,
    type SqlContainerGetResults,
    type SqlDatabaseGetResults,
    type ThroughputSettingsGetResults,
} from '@azure/arm-cosmosdb';
import { PartitionKeyDefinitionVersion, PartitionKeyKind, type ContainerDefinition } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import { SchemaService } from '../../services/SchemaService';
import { type ContainerResource, type DatabaseResource } from '../../tree/cosmosdb/models/CosmosDBTypes';
import { type AzureResourceMetadata } from '../AzureResourceMetadata';
import { type CosmosDBControlPlane, type ThroughputResource } from './CosmosDBControlPlane';

/**
 * Control-plane implementation that uses the Azure Resource Manager
 * (`@azure/arm-cosmosdb`) `sqlResources` operations. Required for accounts
 * configured with native data-plane RBAC where data-plane control operations
 * are rejected by the service. Available only for Azure-signed-in accounts
 * (an `AccountInfo`/`NoSqlQueryConnection` that carries an
 * {@link AzureResourceMetadata}).
 */
export class ArmCosmosDBControlPlane implements CosmosDBControlPlane {
    private armClientPromise?: Promise<CosmosDBManagementClient>;

    public constructor(private readonly metadata: AzureResourceMetadata) {}

    private get resourceGroup(): string {
        return this.metadata.resourceGroup;
    }

    private get accountName(): string {
        return this.metadata.accountName;
    }

    private get endpoint(): string {
        return this.metadata.documentEndpoint;
    }

    public async listDatabases(): Promise<DatabaseResource[]> {
        const client = await this.getArmClient();
        const items: DatabaseResource[] = [];
        for await (const db of client.sqlResources.listSqlDatabases(this.resourceGroup, this.accountName)) {
            items.push(toDatabaseResource(db));
        }
        return items;
    }

    public async createDatabase(databaseId: string): Promise<DatabaseResource> {
        const client = await this.getArmClient();
        const response = await client.sqlResources.beginCreateUpdateSqlDatabaseAndWait(
            this.resourceGroup,
            this.accountName,
            databaseId,
            { resource: { id: databaseId }, options: {} },
        );
        return toDatabaseResource(response);
    }

    public async deleteDatabase(databaseId: string): Promise<void> {
        const client = await this.getArmClient();
        await client.sqlResources.beginDeleteSqlDatabaseAndWait(this.resourceGroup, this.accountName, databaseId);
        await SchemaService.getInstance().deleteSchemasForDatabase(this.endpoint, databaseId);
    }

    public async listContainers(databaseId: string): Promise<ContainerResource[]> {
        const client = await this.getArmClient();
        const items: ContainerResource[] = [];
        for await (const c of client.sqlResources.listSqlContainers(this.resourceGroup, this.accountName, databaseId)) {
            items.push(toContainerResource(c));
        }
        return items;
    }

    public async createContainer(
        databaseId: string,
        definition: ContainerDefinition,
        throughput?: number,
    ): Promise<ContainerResource> {
        const client = await this.getArmClient();
        const containerId = definition.id!;
        const partitionKeyPaths = definition.partitionKey?.paths ?? [];
        const kind =
            definition.partitionKey?.kind === PartitionKeyKind.MultiHash ||
            (definition.partitionKey?.kind === undefined && partitionKeyPaths.length > 1)
                ? PartitionKeyKind.MultiHash
                : PartitionKeyKind.Hash;
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
            options: throughput && throughput !== 0 ? { throughput } : {},
        };

        const response = await client.sqlResources.beginCreateUpdateSqlContainerAndWait(
            this.resourceGroup,
            this.accountName,
            databaseId,
            containerId,
            parameters,
        );
        return toContainerResource(response);
    }

    public async deleteContainer(databaseId: string, containerId: string): Promise<void> {
        const client = await this.getArmClient();
        await client.sqlResources.beginDeleteSqlContainerAndWait(
            this.resourceGroup,
            this.accountName,
            databaseId,
            containerId,
        );
        await SchemaService.getInstance().deleteSchemasForContainer(this.endpoint, databaseId, containerId);
    }

    public async readDatabaseThroughput(databaseId: string): Promise<ThroughputResource | undefined> {
        const client = await this.getArmClient();
        try {
            const response = await client.sqlResources.getSqlDatabaseThroughput(
                this.resourceGroup,
                this.accountName,
                databaseId,
            );
            return toThroughputResource(response);
        } catch (err) {
            if (isNotFound(err)) {
                return undefined;
            }
            throw err;
        }
    }

    public async readContainerThroughput(
        databaseId: string,
        containerId: string,
    ): Promise<ThroughputResource | undefined> {
        const client = await this.getArmClient();
        try {
            const response = await client.sqlResources.getSqlContainerThroughput(
                this.resourceGroup,
                this.accountName,
                databaseId,
                containerId,
            );
            return toThroughputResource(response);
        } catch (err) {
            if (!isNotFound(err)) {
                throw err;
            }
        }
        // Container may inherit throughput from a shared-throughput database.
        return this.readDatabaseThroughput(databaseId);
    }

    private getArmClient(): Promise<CosmosDBManagementClient> {
        if (!this.armClientPromise) {
            this.armClientPromise = (async () => {
                const client = await this.metadata.getClient();
                if (!client) {
                    throw new Error(l10n.t('Failed to connect to Cosmos DB account'));
                }
                return client;
            })();
        }
        return this.armClientPromise;
    }
}

const EMPTY_RESOURCE_FIELDS = {
    _rid: '',
    _self: '',
    _etag: '',
    _ts: 0,
    _attachments: '',
};

function toDatabaseResource(db: SqlDatabaseGetResults): DatabaseResource {
    const resource = db.resource;
    return {
        id: resource?.id ?? db.name ?? '',
        ...EMPTY_RESOURCE_FIELDS,
        _rid: resource?.rid ?? '',
        _ts: resource?.ts ?? 0,
        _etag: resource?.etag ?? '',
    };
}

function toContainerResource(c: SqlContainerGetResults): ContainerResource {
    const resource = c.resource;
    const partitionKey = resource?.partitionKey;
    return {
        id: resource?.id ?? c.name ?? '',
        partitionKey: partitionKey
            ? {
                  paths: partitionKey.paths ?? [],
                  kind: (partitionKey.kind as PartitionKeyKind | undefined) ?? PartitionKeyKind.Hash,
                  version: (partitionKey.version as PartitionKeyDefinitionVersion | undefined) ?? undefined,
                  systemKey: partitionKey.systemKey,
              }
            : undefined,
        // The ARM and data-plane SDKs declare these policy types separately
        // but the runtime shapes are identical. Cast through `unknown` to
        // bridge them without copying every nested field.
        indexingPolicy: resource?.indexingPolicy as unknown as ContainerResource['indexingPolicy'],
        defaultTtl: resource?.defaultTtl,
        uniqueKeyPolicy: resource?.uniqueKeyPolicy as unknown as ContainerResource['uniqueKeyPolicy'],
        conflictResolutionPolicy:
            resource?.conflictResolutionPolicy as unknown as ContainerResource['conflictResolutionPolicy'],
        ...EMPTY_RESOURCE_FIELDS,
        _rid: resource?.rid ?? '',
        _ts: resource?.ts ?? 0,
        _etag: resource?.etag ?? '',
    };
}

function toThroughputResource(response: ThroughputSettingsGetResults): ThroughputResource | undefined {
    const resource = response.resource;
    if (!resource) {
        return { raw: response };
    }
    return {
        throughput: resource.throughput,
        autoscaleMaxThroughput: resource.autoscaleSettings?.maxThroughput,
        minimumThroughput: parseMinimumThroughput(resource.minimumThroughput),
        raw: response,
    };
}

function parseMinimumThroughput(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

function isNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
        return false;
    }
    const e = err as { statusCode?: number; code?: string | number };
    return e.statusCode === 404 || e.code === 404 || e.code === 'NotFound' || e.code === 'ResourceNotFound';
}
