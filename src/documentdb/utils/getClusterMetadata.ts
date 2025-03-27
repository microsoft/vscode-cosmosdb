/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import * as crypto from 'crypto';
import { type Admin, type MongoClient } from 'mongodb';
import { AzureDomains, extractDomainFromHost, hasAzureDomain, hasDomainSuffix } from './connectionStringHelpers';

/**
 * Interface to define the structure of MongoDB cluster metadata.
 */
export interface ClusterMetadata {
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
export async function getClusterMetadata(client: MongoClient, hosts: string[]): Promise<ClusterMetadata> {
    const result: ClusterMetadata = {};

    const adminDb = client.db().admin();

    await fetchBuildInfo(adminDb, result);
    await fetchServerStatus(adminDb, result);
    await fetchTopologyInfo(adminDb, result);
    await fetchHostInfo(adminDb, result);
    processDomainInfo(hosts, result);

    return result;
}

async function fetchBuildInfo(adminDb: Admin, result: ClusterMetadata): Promise<void> {
    try {
        const buildInfo = await adminDb.command({ buildInfo: 1 });
        result['serverInfo_version'] = buildInfo.version;
        result['serverInfo_platform'] = buildInfo.platform;
        result['serverInfo_storageEngines'] = (buildInfo.storageEngines as string[])?.join(';');
    } catch (error) {
        try {
            result['serverInfo_error'] = error instanceof Error ? error.message : String(error);
        } catch {
            // Last resort if error processing itself fails
            result['serverInfo_errorFallback'] = 'Failed to process error details';
        }
    }
}

async function fetchServerStatus(adminDb: Admin, result: ClusterMetadata): Promise<void> {
    try {
        const serverStatus = await adminDb.command({ serverStatus: 1 });
        result['serverStatus_uptime'] = serverStatus.uptime.toString();
    } catch (error) {
        try {
            result['serverStatus_error'] = error instanceof Error ? error.message : String(error);
        } catch {
            // Last resort if error processing itself fails
            result['serverStatus_errorFallback'] = 'Failed to process error details';
        }
    }
}

async function fetchTopologyInfo(adminDb: Admin, result: ClusterMetadata): Promise<void> {
    try {
        const helloInfo = await adminDb.command({ hello: 1 });
        result['topology_type'] = helloInfo.msg || 'unknown';
        result['topology_numberOfServers'] = (helloInfo.hosts?.length || 0).toString();
        result['topology_minWireVersion'] = helloInfo.minWireVersion.toString();
        result['topology_maxWireVersion'] = helloInfo.maxWireVersion.toString();
    } catch (error) {
        try {
            result['topology_error'] = error instanceof Error ? error.message : String(error);
        } catch {
            // Last resort if error processing itself fails
            result['topology_errorFallback'] = 'Failed to process error details';
        }
    }
}

async function fetchHostInfo(adminDb: Admin, result: ClusterMetadata): Promise<void> {
    try {
        const hostInfo = await adminDb.command({ hostInfo: 1 });
        if (hostInfo && typeof hostInfo.currentTime !== 'undefined') {
            hostInfo.currentTime = 'redacted'; // Redact current time
        }
        if (hostInfo && hostInfo.system && typeof hostInfo.system.currentTime !== 'undefined') {
            hostInfo.system.currentTime = 'redacted'; // Redact system current time
        }
        // TODO: review in April 2024 if we need to redact more of the hostInfo fields.
        result['hostInfo_json'] = JSON.stringify(hostInfo);
    } catch (error) {
        try {
            result['hostInfo_error'] = error instanceof Error ? error.message : String(error);
        } catch {
            // Last resort if error processing itself fails
            result['hostInfo_errorFallback'] = 'Failed to process error details';
        }
    }
}

function processDomainInfo(hosts: string[], result: ClusterMetadata): void {
    for (const [index, host] of hosts.entries()) {
        const telemetrySuffix = index > 0 ? `_h${index}` : '';
        try {
            let domainStatistics = false;
            const hostWithoutPort = extractDomainFromHost(host);
            if (hasAzureDomain(hostWithoutPort)) {
                // For Azure domains, record that fact and identify the API when applicable.
                result[`domainInfo_isAzure${telemetrySuffix}`] = 'true';
                if (hasDomainSuffix(AzureDomains.RU, hostWithoutPort)) {
                    result[`domainInfo_api${telemetrySuffix}`] = 'RU';
                } else if (hasDomainSuffix(AzureDomains.vCore, hostWithoutPort)) {
                    result[`domainInfo_api${telemetrySuffix}`] = 'vCore';
                } else {
                    // For other Azure domains, produce hash values for diagnostics.
                    domainStatistics = true;
                }
            } else {
                // For non-Azure domains, do not log the full host.
                // Instead, capture aggregated statistics by analyzing only the most significant 3 segments.
                result[`domainInfo_isAzure${telemetrySuffix}`] = 'false';
                // For non-Azure domains, produce hash values for diagnostics.
                domainStatistics = true;
            }

            if (domainStatistics) {
                const domainParts = hostWithoutPort.split('.'); // e.g., ['private', 'acluster', 'server', 'tld']
                result[`domainInfo_levels${telemetrySuffix}`] = domainParts.length.toString(); // Store the full domain for reference

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
        } catch (error) {
            // Capture multiple aspects of the error to ensure we get something useful in telemetry
            try {
                // Start with basic error type identification
                const errorType = error ? (error.constructor ? error.constructor.name : typeof error) : 'undefined';

                // Create a detailed error entry
                if (error instanceof Error) {
                    // For standard Error objects, capture name, message and stack (trimmed)
                    result[`domainInfo_errorType${telemetrySuffix}`] = errorType;
                    result[`domainInfo_error${telemetrySuffix}`] = error.message || 'Empty error message';

                    // Capture any custom properties on the error object
                    const errorProps = Object.keys(error).filter((k) => k !== 'stack' && k !== 'message');
                    if (errorProps.length > 0) {
                        result[`domainInfo_errorProps${telemetrySuffix}`] = errorProps.join(',');
                    }
                } else if (error === null) {
                    // Handle null errors
                    result[`domainInfo_errorType${telemetrySuffix}`] = 'null';
                    result[`domainInfo_error${telemetrySuffix}`] = 'Error was null';
                } else if (error === undefined) {
                    // Handle undefined errors
                    result[`domainInfo_errorType${telemetrySuffix}`] = 'undefined';
                    result[`domainInfo_error${telemetrySuffix}`] = 'Error was undefined';
                } else {
                    // For non-standard errors (like strings, objects, etc.)
                    result[`domainInfo_errorType${telemetrySuffix}`] = errorType;

                    // Try different methods to extract meaningful content
                    const errorStr =
                        typeof error === 'object'
                            ? JSON.stringify(error).substring(0, 200) // Limit JSON size
                            : String(error);

                    result[`domainInfo_error${telemetrySuffix}`] =
                        errorStr || `Non-standard error of type ${errorType}`;
                }
            } catch {
                // Last resort if error processing itself fails
                result[`domainInfo_errorFallback${telemetrySuffix}`] = 'Failed to process error details';
            }
        }
    }
}
