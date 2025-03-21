/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import * as crypto from 'crypto';
import { type MongoClient } from 'mongodb';
import { AzureDomains, extractDomainFromHost, hasAzureDomain, hasDomainSuffix } from './connectionStringHelpers';

/**
 * Interface to define the structure of MongoDB cluster metadata.
 */
export interface MongoClusterMetadata {
    [key: string]: string | undefined;
}

/**
 * Retrieves non-sensitive metadata for a MongoDB cluster.
 * Telemetry-friendly techniques (such as hashing parts of a host) are used to avoid exposing sensitive data.
 *
 * @param client - The MongoClient instance connected to the MongoDB cluster.
 * @param hosts  An array of host strings.
 * @returns A promise that resolves to an object containing various metadata about the MongoDB cluster.
 *
 */
export async function getMongoClusterMetadata(client: MongoClient, hosts: string[]): Promise<MongoClusterMetadata> {
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

    // Fetch host information, redacting sensitive data.
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

    // Explore domain information from the hosts. This is non-sensitive and can be useful for diagnostics.
    // Only information about known domains is collected to avoid any sensitive data.
    try {
        for (const [index, host] of hosts.entries()) {
            const telemetrySuffix = index > 0 ? `_h${index}` : '';

            const hostWithoutPort = extractDomainFromHost(host);
            if (hasAzureDomain(hostWithoutPort)) {
                // For Azure domains, record that fact and identify the API when applicable.
                result['domainInfo_isAzure' + telemetrySuffix] = 'true';
                if (hasDomainSuffix(AzureDomains.RU, hostWithoutPort)) {
                    result['domainInfo_api' + telemetrySuffix] = 'RU';
                } else if (hasDomainSuffix(AzureDomains.vCore, hostWithoutPort)) {
                    result['domainInfo_api' + telemetrySuffix] = 'vCore';
                }
            } else {
                // For non-Azure domains, do not log the full host.
                // Instead, capture aggregated statistics by analyzing only the most significant 3 segments.
                result['domainInfo_isAzure' + telemetrySuffix] = 'false';

                const domainParts = hostWithoutPort.split('.'); // e.g., ['private', 'acluster', 'server', 'tld']
                result['domainInfo_levels' + telemetrySuffix] = domainParts.length.toString(); // Store the full domain for reference

                // Only consider the last three segments.
                const levelsToProcess = Math.min(3, domainParts.length);

                for (let level = 1; level <= levelsToProcess; level++) {
                    // Construct a domain fragment from the last `level` segments.
                    // Example: level 1 -> "tld"; level 2 -> "server.tld"; level 3 -> "acluster.server.tld".
                    const partialDomain = domainParts.slice(-level).join('.');
                    // Generate a SHA256 hash for the domain fragment and use only the first 8 hex characters.
                    const hashedDomain = crypto
                        .createHash('sha256')
                        .update(partialDomain)
                        .digest('hex')
                        .substring(0, 8);
                    result[`domainInfo_domain_l${level}${telemetrySuffix}`] = hashedDomain;
                }
            }
        }
    } catch (error) {
        result['domainInfo_error'] = error instanceof Error ? error.message : String(error);
    }

    // Return the collected metadata.
    return result;
}
