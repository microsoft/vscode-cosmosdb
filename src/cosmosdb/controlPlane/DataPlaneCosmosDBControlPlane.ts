/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    PartitionKeyDefinitionVersion,
    PartitionKeyKind,
    type ContainerDefinition,
    type ContainerRequest,
    type CosmosClient,
    type RequestOptions,
    type StoredProcedureDefinition,
    type TriggerDefinition,
} from '@azure/cosmos';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import {
    type ContainerResource,
    type DatabaseResource,
    type StoredProcedureResource,
    type TriggerResource,
} from '../../tree/cosmosdb/models/CosmosDBTypes';
import { nonNullProp } from '../../utils/nonNull';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';
import { withClaimsChallengeHandling } from '../withClaimsChallengeHandling';
import { type CosmosDBControlPlane, type ThroughputResource } from './CosmosDBControlPlane';

/**
 * Control-plane implementation that routes every operation through the
 * data-plane `CosmosClient`. Used for the local emulator and for
 * workspace-attached connection-string accounts, where ARM is not reachable.
 */
export class DataPlaneCosmosDBControlPlane implements CosmosDBControlPlane {
    public constructor(private readonly accountInfo: AccountInfo | NoSqlQueryConnection) {}

    private withClient<T>(callback: (client: CosmosClient) => Promise<T>): Promise<T> {
        return withClaimsChallengeHandling(
            this.accountInfo.endpoint,
            this.accountInfo.credentials,
            this.accountInfo.isEmulator,
            callback,
        );
    }

    public async listDatabases(): Promise<DatabaseResource[]> {
        return this.withClient(async (client) => {
            const result = await client.databases.readAll().fetchAll();
            return result.resources;
        });
    }

    public async createDatabase(databaseId: string): Promise<DatabaseResource> {
        return this.withClient(async (client) => {
            const response = await client.databases.create({ id: databaseId });
            return nonNullProp(response, 'resource');
        });
    }

    public async deleteDatabase(databaseId: string): Promise<void> {
        await this.withClient(async (client) => {
            await client.database(databaseId).delete();
        });
    }

    public async listContainers(databaseId: string): Promise<ContainerResource[]> {
        return this.withClient(async (client) => {
            const result = await client.database(databaseId).containers.readAll().fetchAll();
            return result.resources;
        });
    }

    public async createContainer(
        databaseId: string,
        definition: ContainerDefinition,
        throughput?: number,
    ): Promise<ContainerResource> {
        const options: RequestOptions = {};
        if (throughput && throughput !== 0) {
            options.offerThroughput = throughput;
        }

        const partitionKeyPaths = definition.partitionKey?.paths ?? [];
        const partitionKeyDefinition = {
            paths: partitionKeyPaths,
            kind:
                definition.partitionKey?.kind === PartitionKeyKind.MultiHash ||
                (definition.partitionKey?.kind === undefined && partitionKeyPaths.length > 1)
                    ? PartitionKeyKind.MultiHash
                    : PartitionKeyKind.Hash,
            version: definition.partitionKey?.version ?? PartitionKeyDefinitionVersion.V2,
        };

        const containerDefinition: ContainerRequest = {
            ...definition,
            id: definition.id!,
            partitionKey: partitionKeyDefinition,
        };

        return this.withClient(async (client) => {
            const response = await client.database(databaseId).containers.create(containerDefinition, options);
            return nonNullProp(response, 'resource');
        });
    }

    public async deleteContainer(databaseId: string, containerId: string): Promise<void> {
        await this.withClient(async (client) => {
            await client.database(databaseId).container(containerId).delete();
        });
    }

    public async readDatabaseThroughput(databaseId: string): Promise<ThroughputResource | undefined> {
        return this.withClient(async (client) => {
            const offer = await client.database(databaseId).readOffer();
            return mapOfferResource(offer.resource);
        });
    }

    public async readContainerThroughput(
        databaseId: string,
        containerId: string,
    ): Promise<ThroughputResource | undefined> {
        return this.withClient(async (client) => {
            const offer = await client.database(databaseId).container(containerId).readOffer();
            if (offer.resource) {
                return mapOfferResource(offer.resource);
            }
            // Container may inherit throughput from the database (shared throughput).
            const dbOffer = await client.database(databaseId).readOffer();
            return mapOfferResource(dbOffer.resource);
        });
    }

    public async listStoredProcedures(databaseId: string, containerId: string): Promise<StoredProcedureResource[]> {
        return this.withClient(async (client) => {
            const result = await client
                .database(databaseId)
                .container(containerId)
                .scripts.storedProcedures.readAll()
                .fetchAll();
            return result.resources;
        });
    }

    public async createStoredProcedure(
        databaseId: string,
        containerId: string,
        definition: StoredProcedureDefinition,
    ): Promise<StoredProcedureResource> {
        return this.withClient(async (client) => {
            const response = await client
                .database(databaseId)
                .container(containerId)
                .scripts.storedProcedures.create(definition);
            return nonNullProp(response, 'resource');
        });
    }

    public async replaceStoredProcedure(
        databaseId: string,
        containerId: string,
        definition: StoredProcedureDefinition,
    ): Promise<StoredProcedureResource> {
        return this.withClient(async (client) => {
            const response = await client
                .database(databaseId)
                .container(containerId)
                .scripts.storedProcedure(definition.id!)
                .replace(definition);
            return nonNullProp(response, 'resource');
        });
    }

    public async deleteStoredProcedure(databaseId: string, containerId: string, procedureId: string): Promise<void> {
        await this.withClient(async (client) => {
            await client.database(databaseId).container(containerId).scripts.storedProcedure(procedureId).delete();
        });
    }

    public async listTriggers(databaseId: string, containerId: string): Promise<TriggerResource[]> {
        return this.withClient(async (client) => {
            const result = await client
                .database(databaseId)
                .container(containerId)
                .scripts.triggers.readAll()
                .fetchAll();
            return result.resources;
        });
    }

    public async readTrigger(
        databaseId: string,
        containerId: string,
        triggerId: string,
    ): Promise<TriggerResource | undefined> {
        return this.withClient(async (client) => {
            const response = await client.database(databaseId).container(containerId).scripts.trigger(triggerId).read();
            return response.resource;
        });
    }

    public async createTrigger(
        databaseId: string,
        containerId: string,
        definition: TriggerDefinition,
    ): Promise<TriggerResource> {
        return this.withClient(async (client) => {
            const response = await client
                .database(databaseId)
                .container(containerId)
                .scripts.triggers.create(definition);
            return nonNullProp(response, 'resource');
        });
    }

    public async replaceTrigger(
        databaseId: string,
        containerId: string,
        definition: TriggerDefinition,
    ): Promise<TriggerResource> {
        return this.withClient(async (client) => {
            const response = await client
                .database(databaseId)
                .container(containerId)
                .scripts.trigger(definition.id!)
                .replace(definition);
            return nonNullProp(response, 'resource');
        });
    }

    public async deleteTrigger(databaseId: string, containerId: string, triggerId: string): Promise<void> {
        await this.withClient(async (client) => {
            await client.database(databaseId).container(containerId).scripts.trigger(triggerId).delete();
        });
    }
}

function mapOfferResource(offer: unknown): ThroughputResource | undefined {
    if (!offer || typeof offer !== 'object') {
        return undefined;
    }
    const o = offer as Record<string, unknown>;
    const content = (o.content ?? {}) as Record<string, unknown>;
    const offerThroughput = typeof content.offerThroughput === 'number' ? content.offerThroughput : undefined;
    const autoscale = (content.offerAutopilotSettings ?? {}) as Record<string, unknown>;
    const autoscaleMaxThroughput = typeof autoscale.maxThroughput === 'number' ? autoscale.maxThroughput : undefined;
    const minimumThroughput =
        typeof content.offerMinimumThroughputParameters === 'object' &&
        content.offerMinimumThroughputParameters !== null &&
        typeof (content.offerMinimumThroughputParameters as Record<string, unknown>).minimumThroughput === 'number'
            ? ((content.offerMinimumThroughputParameters as Record<string, unknown>).minimumThroughput as number)
            : undefined;
    return {
        throughput: offerThroughput,
        autoscaleMaxThroughput,
        minimumThroughput,
        raw: offer,
    };
}
