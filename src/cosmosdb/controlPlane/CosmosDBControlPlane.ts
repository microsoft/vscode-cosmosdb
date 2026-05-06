/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type StoredProcedureDefinition, type TriggerDefinition } from '@azure/cosmos';
import {
    type ContainerResource,
    type DatabaseResource,
    type StoredProcedureResource,
    type TriggerResource,
} from '../../tree/cosmosdb/models/CosmosDBTypes';

/**
 * A minimal serializable view of a database or container's throughput
 * configuration. Both the ARM and the data-plane implementation populate the
 * same DTO so that the consuming UI does not have to know which control-plane
 * surface produced the value.
 */
export interface ThroughputResource {
    /** Manual provisioned throughput (RU/s). Undefined for autoscale. */
    throughput?: number;
    /** Maximum RU/s for autoscale. Undefined for manual throughput. */
    autoscaleMaxThroughput?: number;
    /** Minimum throughput allowed for the resource (when reported by the service). */
    minimumThroughput?: number;
    /** Free-form raw payload for diagnostic display. */
    raw?: unknown;
}

/**
 * Abstraction over Azure Cosmos DB control-plane operations for the SQL
 * (NoSQL) API. Implementations either route through the ARM management plane
 * (preferred for Azure-signed-in accounts) or through the data-plane
 * `CosmosClient` (used for the local emulator and workspace-attached
 * connection-string accounts where ARM is not available).
 */
export interface CosmosDBControlPlane {
    listDatabases(): Promise<DatabaseResource[]>;
    createDatabase(databaseId: string): Promise<DatabaseResource>;
    deleteDatabase(databaseId: string): Promise<void>;

    listContainers(databaseId: string): Promise<ContainerResource[]>;
    createContainer(
        databaseId: string,
        definition: ContainerDefinition,
        throughput?: number,
    ): Promise<ContainerResource>;
    deleteContainer(databaseId: string, containerId: string): Promise<void>;

    readDatabaseThroughput(databaseId: string): Promise<ThroughputResource | undefined>;
    readContainerThroughput(databaseId: string, containerId: string): Promise<ThroughputResource | undefined>;

    listStoredProcedures(databaseId: string, containerId: string): Promise<StoredProcedureResource[]>;
    createStoredProcedure(
        databaseId: string,
        containerId: string,
        definition: StoredProcedureDefinition,
    ): Promise<StoredProcedureResource>;
    replaceStoredProcedure(
        databaseId: string,
        containerId: string,
        definition: StoredProcedureDefinition,
    ): Promise<StoredProcedureResource>;
    deleteStoredProcedure(databaseId: string, containerId: string, procedureId: string): Promise<void>;

    listTriggers(databaseId: string, containerId: string): Promise<TriggerResource[]>;
    readTrigger(databaseId: string, containerId: string, triggerId: string): Promise<TriggerResource | undefined>;
    createTrigger(databaseId: string, containerId: string, definition: TriggerDefinition): Promise<TriggerResource>;
    replaceTrigger(databaseId: string, containerId: string, definition: TriggerDefinition): Promise<TriggerResource>;
    deleteTrigger(databaseId: string, containerId: string, triggerId: string): Promise<void>;
}
