/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition } from '@azure/cosmos';
import { type ContainerResource, type DatabaseResource } from '../../tree/cosmosdb/models/CosmosDBTypes';

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
 * (NoSQL) API: databases, containers, and throughput. Implementations either
 * route through the ARM management plane (preferred for Azure-signed-in
 * accounts) or through the data-plane `CosmosClient` (used for the local
 * emulator and workspace-attached connection-string accounts where ARM is
 * not available).
 *
 * Stored procedures, triggers, and user-defined functions are intentionally
 * not included here: they are data-plane resources and callers should access
 * them through the data-plane `CosmosClient` (see `withClaimsChallengeHandling`).
 *
 * Error contract: all methods throw on failure. The data-plane implementation
 * surfaces `ErrorResponse` from `@azure/cosmos`; the ARM implementation
 * surfaces `RestError` from `@azure/core-rest-pipeline`. A successful return
 * (including `void`) means the operation completed; callers do not need to
 * inspect status codes or response headers. Translating those errors into
 * user-visible notifications is the responsibility of the surrounding
 * `callWithTelemetryAndErrorHandling` wrapper used by command handlers.
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
}
