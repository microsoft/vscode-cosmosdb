/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { type MongoClient } from 'mongodb';

/**
 * Interface to define the structure of MongoDB cluster metadata.
 * The data structure is flat with dot notation in field names to meet requirements in the telemetry section.
 *
 * The fields are optional to allow for partial data collection in case of errors.
 */
export interface MongoClusterMetadata {
    'serverInfo.version'?: string; // MongoDB server version (non-sensitive)
    'serverInfo.gitVersion'?: string; // Git version of the MongoDB server (non-sensitive)
    'serverInfo.opensslVersion'?: string; // OpenSSL version used by the server (non-sensitive)
    'serverInfo.platform'?: string; // Server platform information (non-sensitive)
    'serverInfo.storageEngines'?: string; // Storage engine used by the server (non-sensitive)
    'serverInfo.modules'?: string; // List of modules loaded by the server (non-sensitive)
    'serverInfo.error'?: string; // Error message if fetching server info fails

    'topology.type'?: string; // Type of topology (e.g., replica set, sharded cluster)
    'topology.numberOfServers'?: string; // Number of servers
    'topology.minWireVersion'?: string; // Minimum wire protocol version supported
    'topology.maxWireVersion'?: string; // Maximum wire protocol version supported
    'topology.error'?: string; // Error message if fetching topology info fails

    'serverStatus.uptime'?: string; // Server uptime in seconds (non-sensitive)
    'serverStatus.connections.current'?: string; // Current number of connections (non-sensitive)
    'serverStatus.connections.available'?: string; // Available connections (non-sensitive)
    'serverStatus.memory.resident'?: string; // Resident memory usage in MB (non-sensitive)
    'serverStatus.memory.virtual'?: string; // Virtual memory usage in MB (non-sensitive)
    'serverStatus.error'?: string; // Error message if fetching server status fails

    'hostInfo.json'?: string; // JSON stringified host information
    'hostInfo.error'?: string; // Error message if fetching host info fails
}

/**
 * Retrieves metadata information about a MongoDB cluster.
 * This data helps improve diagnostics and user experience.
 * No internal server addresses or sensitive information are read.
 *
 * @param client - The MongoClient instance connected to the MongoDB cluster.
 * @returns A promise that resolves to an object containing various metadata about the MongoDB cluster.
 *
 */
export async function getMongoClusterMetadata(client: MongoClient): Promise<MongoClusterMetadata> {
    const result: MongoClusterMetadata = {};

    const adminDb = client.db().admin();

    // Fetch build info (server version, git version, etc.)
    // This information is non-sensitive and aids in diagnostics.
    try {
        const buildInfo = await adminDb.command({ buildInfo: 1 });
        result['serverInfo_version'] = buildInfo.version;
        result['serverInfo_platform'] = buildInfo.platform;
        result['serverInfo_storageEngines'] = (buildInfo.storageEngines as string[])?.join(';');
    } catch (error) {
        result['serverInfo_error'] = error instanceof Error ? error.message : String(error);
    }

    // Fetch server status information.
    // Includes non-sensitive data like uptime and connection metrics.
    try {
        const serverStatus = await adminDb.command({ serverStatus: 1 });
        result['serverStatus_uptime'] = serverStatus.uptime.toString();
    } catch (error) {
        result['serverStatus_error'] = error instanceof Error ? error.message : String(error);
    }

    // Fetch topology information using the 'hello' command.
    // Internal server addresses are not collected to ensure privacy.
    try {
        const helloInfo = await adminDb.command({ hello: 1 });
        result['topology_type'] = helloInfo.msg || 'unknown';
        result['topology_numberOfServers'] = (helloInfo.hosts?.length || 0).toString();
        result['topology_minWireVersion'] = helloInfo.minWireVersion.toString();
        result['topology_maxWireVersion'] = helloInfo.maxWireVersion.toString();
    } catch (error) {
        result['topology_error'] = error instanceof Error ? error.message : String(error);
    }

    // Fetch host information
    try {
        const hostInfo = await adminDb.command({ hostInfo: 1 });
        if (hostInfo && typeof hostInfo.currentTime !== 'undefined') {
            hostInfo.currentTime = 'redacted'; // Redact current time
        }
        // TODO: review in April 2024 if we need to redact more of the hostInfo fields.
        result['hostInfo_json'] = JSON.stringify(hostInfo);
    } catch (error) {
        result['hostInfo_error'] = error instanceof Error ? error.message : String(error);
    }

    // Return the collected metadata.
    return result;
}
