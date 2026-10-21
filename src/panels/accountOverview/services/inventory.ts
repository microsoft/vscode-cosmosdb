/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type CosmosDBManagementClient,
    type SqlContainerGetResults,
    type SqlDatabaseGetResults,
    type ThroughputSettingsGetResults,
} from '@azure/arm-cosmosdb';
import { getSystemCreatedAt } from './resourceAge';
import { classifyUnavailable, type UnavailableReason } from './shared';

// ─── Static databases/containers inventory ──────────────────────────────────────
//
// Reads only the ARM `sqlResources` surface — no Azure Monitor calls. This
// extension only ships a full data-plane experience for the SQL (NoSQL) API, so
// the inventory below is scoped to `sqlResources`; non-NoSQL accounts get the
// header only, with an explicit "not supported" inventory empty-state handled by
// the router.

export type ThroughputMode = 'dedicated' | 'shared' | 'autoscale' | 'serverless' | 'unknown';
export type OfferLevel = 'container' | 'database' | 'none';
export type OfferThroughputMode = 'manual' | 'autoscale' | 'serverless' | 'unknown';

export interface InventoryContainerRow {
    databaseId: string;
    containerId: string;
    throughputMode: ThroughputMode;
    throughputRU?: number;
    offerLevel?: OfferLevel;
    offerThroughputMode?: OfferThroughputMode;
    /** Container resource creation time from ARM `systemData.createdAt`, when available. */
    resourceCreatedAt?: string;
    /** Backing throughput-offer resource creation time, when distinct from the container. */
    offerCreatedAt?: string;
    partitionKeyPaths: string[];
    indexingMode: string;
    excludedPathCount: number;
    /** Excluded paths other than the default root `_etag` exclusion, for indexing-cost advisories. */
    userExcludedPathCount: number;
    compositeIndexCount: number;
    /** Static-inventory fallback; real per-row health comes from `getInventoryMetrics`. */
    health: 'Healthy';
}

export interface InventoryThroughputOffer {
    databaseId: string;
    containerId?: string;
    offerLevel: Exclude<OfferLevel, 'none'>;
    throughputMode: ThroughputMode;
    offerThroughputMode: Exclude<OfferThroughputMode, 'serverless' | 'unknown'>;
    throughputRU: number;
    resourceCreatedAt?: string;
}

export interface SqlInventoryDetails {
    databases: string[];
    rows: InventoryContainerRow[];
    offers: InventoryThroughputOffer[];
}

function isNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
        return false;
    }
    const e = err as { statusCode?: number; code?: string | number };
    return e.statusCode === 404 || e.code === 404 || e.code === 'NotFound' || e.code === 'ResourceNotFound';
}

function resolveDatabaseThroughputMode(dbThroughput: ThroughputSettingsGetResults | undefined): {
    mode: ThroughputMode;
    ru: number | undefined;
    offerThroughputMode: 'manual' | 'autoscale' | 'unknown';
} {
    if (!dbThroughput?.resource) {
        return { mode: 'unknown', ru: undefined, offerThroughputMode: 'unknown' };
    }
    const autoscaleMax = dbThroughput.resource.autoscaleSettings?.maxThroughput;
    if (autoscaleMax !== undefined) {
        return { mode: 'autoscale', ru: autoscaleMax, offerThroughputMode: 'autoscale' };
    }
    return { mode: 'shared', ru: dbThroughput.resource.throughput, offerThroughputMode: 'manual' };
}

/**
 * Walks the `sqlResources` ARM surface and resolves each container's throughput
 * mode/RU and indexing shape into the static inventory rows the dashboard table
 * renders. Per-row health is a `Healthy` placeholder that `getInventoryMetrics`
 * later refines from Azure Monitor.
 */
export async function getSqlInventoryDetails(
    client: CosmosDBManagementClient,
    resourceGroup: string,
    accountName: string,
    isServerless: boolean,
): Promise<SqlInventoryDetails> {
    const rows: InventoryContainerRow[] = [];
    const offers: InventoryThroughputOffer[] = [];

    const databases: SqlDatabaseGetResults[] = [];
    for await (const db of client.sqlResources.listSqlDatabases(resourceGroup, accountName)) {
        databases.push(db);
    }

    for (const db of databases) {
        const databaseId = db.resource?.id ?? db.name ?? '';
        const databaseCreatedAt = getSystemCreatedAt(db);

        let dbThroughput: ThroughputSettingsGetResults | undefined;
        if (!isServerless) {
            try {
                dbThroughput = await client.sqlResources.getSqlDatabaseThroughput(
                    resourceGroup,
                    accountName,
                    databaseId,
                );
            } catch (err) {
                if (!isNotFound(err)) {
                    throw err;
                }
            }
        }
        const resolvedDatabaseOffer = resolveDatabaseThroughputMode(dbThroughput);
        if (resolvedDatabaseOffer.ru !== undefined && resolvedDatabaseOffer.offerThroughputMode !== 'unknown') {
            offers.push({
                databaseId,
                offerLevel: 'database',
                throughputMode: resolvedDatabaseOffer.mode,
                offerThroughputMode: resolvedDatabaseOffer.offerThroughputMode,
                throughputRU: resolvedDatabaseOffer.ru,
                resourceCreatedAt: databaseCreatedAt,
            });
        }

        const containers: SqlContainerGetResults[] = [];
        for await (const c of client.sqlResources.listSqlContainers(resourceGroup, accountName, databaseId)) {
            containers.push(c);
        }

        for (const container of containers) {
            const containerId = container.resource?.id ?? container.name ?? '';
            const indexingPolicy = container.resource?.indexingPolicy;
            const containerCreatedAt = getSystemCreatedAt(container);

            let throughputMode: ThroughputMode;
            let throughputRU: number | undefined;
            let offerLevel: OfferLevel = 'none';
            let offerThroughputMode: OfferThroughputMode = isServerless ? 'serverless' : 'unknown';
            let offerCreatedAt: string | undefined;

            if (isServerless) {
                throughputMode = 'serverless';
                throughputRU = undefined;
            } else {
                let containerThroughput: ThroughputSettingsGetResults | undefined;
                try {
                    containerThroughput = await client.sqlResources.getSqlContainerThroughput(
                        resourceGroup,
                        accountName,
                        databaseId,
                        containerId,
                    );
                } catch (err) {
                    if (!isNotFound(err)) {
                        throw err;
                    }
                }

                if (containerThroughput?.resource) {
                    // Dedicated (container-level) throughput.
                    const autoscaleMax = containerThroughput.resource.autoscaleSettings?.maxThroughput;
                    throughputMode = autoscaleMax !== undefined ? 'autoscale' : 'dedicated';
                    throughputRU = autoscaleMax ?? containerThroughput.resource.throughput;
                    offerLevel = 'container';
                    offerThroughputMode = autoscaleMax !== undefined ? 'autoscale' : 'manual';
                    offerCreatedAt = containerCreatedAt;
                    if (throughputRU !== undefined) {
                        offers.push({
                            databaseId,
                            containerId,
                            offerLevel,
                            throughputMode,
                            offerThroughputMode,
                            throughputRU,
                            resourceCreatedAt: containerCreatedAt,
                        });
                    }
                } else {
                    // No dedicated throughput ⇒ falls back to the shared database throughput.
                    throughputMode = resolvedDatabaseOffer.mode;
                    throughputRU = resolvedDatabaseOffer.ru;
                    offerLevel = throughputRU === undefined ? 'none' : 'database';
                    offerThroughputMode = resolvedDatabaseOffer.offerThroughputMode;
                    offerCreatedAt = databaseCreatedAt;
                }
            }

            rows.push({
                databaseId,
                containerId,
                throughputMode,
                throughputRU,
                offerLevel,
                offerThroughputMode,
                resourceCreatedAt: containerCreatedAt,
                offerCreatedAt,
                partitionKeyPaths: container.resource?.partitionKey?.paths ?? [],
                indexingMode: indexingPolicy?.indexingMode ?? 'consistent',
                excludedPathCount: indexingPolicy?.excludedPaths?.length ?? 0,
                userExcludedPathCount:
                    indexingPolicy?.excludedPaths?.filter(({ path }) => path !== '/_etag/?' && path !== '/"_etag"/?')
                        .length ?? 0,
                compositeIndexCount: indexingPolicy?.compositeIndexes?.length ?? 0,
                health: 'Healthy',
            });
        }
    }

    return {
        databases: databases.map((database) => database.resource?.id ?? database.name ?? '').filter(Boolean),
        rows,
        offers,
    };
}

export async function getSqlInventory(
    client: CosmosDBManagementClient,
    resourceGroup: string,
    accountName: string,
    isServerless: boolean,
): Promise<InventoryContainerRow[]> {
    const inventory = await getSqlInventoryDetails(client, resourceGroup, accountName, isServerless);
    return inventory.rows;
}

/** The shaped inventory outcome the router surfaces: rows on success, or an explicit unavailable reason. */
export interface InventoryResult {
    /** False when the ARM walk failed (for example a 403); pairs with {@link reason}. */
    available: boolean;
    /** When {@link available} is false, why the section could not load. See {@link UnavailableReason}. */
    reason?: UnavailableReason;
    rows: InventoryContainerRow[];
    databases: string[];
}

/**
 * Wraps {@link getSqlInventory} so an ARM failure degrades to an explicit empty-state instead of
 * bubbling up and hanging the whole dashboard. A 403 (or ARM `AuthorizationFailed`/`Forbidden`)
 * becomes `reason: 'rbac'`; any other failure becomes `reason: 'noData'`. Mirrors the shaped
 * `available`/`reason` contract the Azure Monitor service functions already return.
 */
export async function getInventoryResult(
    client: CosmosDBManagementClient,
    resourceGroup: string,
    accountName: string,
    isServerless: boolean,
): Promise<InventoryResult> {
    try {
        const { rows, databases } = await getSqlInventoryDetails(client, resourceGroup, accountName, isServerless);
        return { available: true, rows, databases };
    } catch (error) {
        return { available: false, reason: classifyUnavailable(error), rows: [], databases: [] };
    }
}
