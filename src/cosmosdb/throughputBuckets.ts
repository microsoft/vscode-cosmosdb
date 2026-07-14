/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { createPipelineRequest } from '@azure/core-rest-pipeline';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { COSMOSDB_ARM_API_VERSION, createFeatureClient } from '../utils/azureClients';
import { type AzureResourceMetadata } from './AzureResourceMetadata';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';
import {
    isThroughputBucketsFeatureRegistered,
    MAX_THROUGHPUT_BUCKETS,
    parseEnabledThroughputBuckets,
} from './throughputBucketsFeature';

const DOCUMENT_DB_PROVIDER = 'Microsoft.DocumentDB';
const THROUGHPUT_BUCKETS_FEATURE = 'ThroughputBuckets';
const MANAGEMENT_ENDPOINT_FALLBACK = 'https://management.azure.com';

/**
 * Returns whether the Throughput Buckets preview is registered for the
 * subscription associated with a query-editor connection.
 *
 * Connections without Azure metadata cannot query subscription feature
 * registrations, so they fail closed rather than exposing a control whose
 * effect cannot be verified.
 */
export async function supportsThroughputBuckets(
    connection: NoSqlQueryConnection | undefined,
    context: IActionContext | undefined,
): Promise<boolean> {
    if (!connection || connection.isEmulator || !connection.azureMetadata || !context) {
        return false;
    }

    try {
        const client = await createFeatureClient(context, connection.azureMetadata.subscription);
        const feature = await client.features.get(DOCUMENT_DB_PROVIDER, THROUGHPUT_BUCKETS_FEATURE);
        return isThroughputBucketsFeatureRegistered(feature);
    } catch {
        // Capability detection is optional. If ARM is unavailable or the user
        // cannot read feature registrations, hide the selector rather than
        // presenting an option that may have no effect.
    }

    return false;
}

/**
 * Resolves the per-bucket enabled state for the query editor's Throughput
 * Bucket selector.
 *
 * Returns `undefined` when the selector should be hidden entirely (the preview
 * is not registered, or the connection cannot be verified). Otherwise returns a
 * fixed-length array where index `i` indicates whether bucket `i + 1` is
 * configured on the container (or its shared-throughput database).
 *
 * The Cosmos DB ARM SDK does not yet model `throughputBuckets`, so the value is
 * read directly from the pinned-api-version REST response. If the buckets
 * cannot be read, all five are reported as enabled to preserve the selector's
 * previous always-available behaviour.
 */
export async function getEnabledThroughputBuckets(
    connection: NoSqlQueryConnection | undefined,
    context: IActionContext | undefined,
): Promise<boolean[] | undefined> {
    if (!(await supportsThroughputBuckets(connection, context))) {
        return undefined;
    }

    // `supportsThroughputBuckets` guarantees these are present; re-narrow for the
    // type checker.
    const metadata = connection?.azureMetadata;
    if (!connection || !metadata) {
        return undefined;
    }

    try {
        return await readEnabledThroughputBuckets(metadata, connection.databaseId, connection.containerId);
    } catch {
        // Reading the configured buckets is best-effort. Fall back to enabling
        // all five rather than blocking selection when the settings cannot be
        // read (e.g. transient ARM error or insufficient permissions).
        return Array.from<boolean>({ length: MAX_THROUGHPUT_BUCKETS }).fill(true);
    }
}

async function readEnabledThroughputBuckets(
    metadata: AzureResourceMetadata,
    databaseId: string,
    containerId: string,
): Promise<boolean[]> {
    const client = await metadata.getClient();
    if (!client) {
        return Array.from<boolean>({ length: MAX_THROUGHPUT_BUCKETS }).fill(true);
    }

    const host = client.$host ?? MANAGEMENT_ENDPOINT_FALLBACK;
    const accountPath =
        `${host}/subscriptions/${metadata.subscription.subscriptionId}` +
        `/resourceGroups/${metadata.resourceGroup}` +
        `/providers/Microsoft.DocumentDB/databaseAccounts/${metadata.accountName}`;
    const query = `?api-version=${COSMOSDB_ARM_API_VERSION}`;

    // Prefer the container's dedicated throughput settings. A 404 means the
    // container inherits throughput (and any buckets) from a shared-throughput
    // database, so fall back to the database-level settings.
    const containerUrl =
        `${accountPath}/sqlDatabases/${encodeURIComponent(databaseId)}` +
        `/containers/${encodeURIComponent(containerId)}/throughputSettings/default${query}`;
    let body = await getThroughputSettings(client, containerUrl);

    if (body === undefined) {
        const databaseUrl = `${accountPath}/sqlDatabases/${encodeURIComponent(databaseId)}/throughputSettings/default${query}`;
        body = await getThroughputSettings(client, databaseUrl);
    }

    return parseEnabledThroughputBuckets(body);
}

/**
 * Issues a GET against an ARM throughput-settings resource and returns the
 * parsed JSON body. Returns `undefined` for a 404 (resource not found / shared
 * throughput) and throws for any other non-success status.
 */
async function getThroughputSettings(client: CosmosDBManagementClient, url: string): Promise<unknown> {
    const response = await client.sendRequest(createPipelineRequest({ url, method: 'GET' }));

    if (response.status === 404) {
        return undefined;
    }
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Unexpected status ${response.status} reading throughput settings`);
    }

    return response.bodyAsText ? JSON.parse(response.bodyAsText) : undefined;
}
