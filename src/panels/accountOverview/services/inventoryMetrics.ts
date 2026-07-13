/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import {
    classifyUnavailable,
    firstValue,
    type HealthState,
    isThrottledStatusCode,
    lastValue,
    type ProvisioningState,
    RANGE_CONFIG,
    seriesContainerKey,
    sustainedTimestamps,
    THROTTLING_SHARE_THRESHOLD,
    type TimeRange,
    type UnavailableReason,
} from './shared';

// ─── Inventory metrics + per-row health ───────────────────────────────────────────
//
// Backfills the inventory table with the columns that require Azure Monitor:
// current storage (`DataUsage + IndexUsage`), 7-day storage growth (first vs.
// last `DataUsage` datapoint), and the recent RU peak
// (`max(NormalizedRUConsumption)` over the chart window). Each metric is fetched
// once for the whole account, split by the `DatabaseName`/`CollectionName`
// dimensions, then keyed back to individual containers. All Azure Monitor
// failures degrade to `available: false` so the webview renders an explicit
// empty-state rather than surfacing an error.

/** Per-row health thresholds, sourced from `cosmosDB.accountOverview.*`. */
export interface HealthThresholds {
    /** Peak normalized RU % at or above which a row is Critical. */
    criticalRuPercent: number;
    /** Peak normalized RU % at or above which a row Needs Attention. */
    warningRuPercent: number;
    /** 7-day storage growth (bytes) above which a row Needs Attention. */
    storageGrowthWarningBytes: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
    criticalRuPercent: 90,
    warningRuPercent: 80,
    storageGrowthWarningBytes: 10 * 1024 * 1024 * 1024,
};

export interface ContainerMetrics {
    databaseId: string;
    containerId: string;
    /** Latest `DataUsage + IndexUsage` in bytes, when reported. */
    storageBytes?: number;
    /** Latest `DataUsage` in bytes, when reported (feeds the IndexingCostRisk rule). */
    dataUsageBytes?: number;
    /** Latest `IndexUsage` in bytes, when reported (feeds the IndexingCostRisk rule). */
    indexUsageBytes?: number;
    /** `DataUsage` delta between the first and last datapoint over 7 days, in bytes. */
    storageGrowthBytes?: number;
    /** `max(NormalizedRUConsumption)` over the selected window (percentage). */
    peakRuPercent?: number;
    /** True when the container saw sustained throttling in the last hour. */
    throttled: boolean;
    health: HealthState;
}

export interface InventoryMetricsResult {
    /** False when Azure Monitor returned no usable series for this API/SKU. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    /** Per-container metrics keyed as `${databaseId}/${containerId}`. */
    metrics: Record<string, ContainerMetrics>;
    /** Account-level health pill (provisioning + throttling only). */
    accountHealth: HealthState;
    /** Epoch milliseconds when the server produced this snapshot. */
    generatedAt: number;
}

/** Provisioning states that ARM reports while an account is mid-operation but not failed. */
const TRANSITIONAL_PROVISIONING_STATES: ReadonlySet<ProvisioningState> = new Set<ProvisioningState>([
    'Creating',
    'Updating',
    'Deleting',
]);

/**
 * Derives per-row health from the collected metrics and configured thresholds.
 * Pure so it can be unit-tested against synthetic metrics.
 */
export function deriveRowHealth(
    metrics: Pick<ContainerMetrics, 'peakRuPercent' | 'storageGrowthBytes' | 'throttled'>,
    thresholds: HealthThresholds,
): HealthState {
    const peak = metrics.peakRuPercent;
    if (metrics.throttled || (peak !== undefined && peak >= thresholds.criticalRuPercent)) {
        return 'Critical';
    }
    if (
        (peak !== undefined && peak >= thresholds.warningRuPercent) ||
        (metrics.storageGrowthBytes !== undefined && metrics.storageGrowthBytes > thresholds.storageGrowthWarningBytes)
    ) {
        return 'Needs Attention';
    }
    return 'Healthy';
}

/**
 * Derives the account-level health pill from provisioning state and whether any
 * container is throttling. Alerts/Advisor inputs are intentionally excluded.
 * Pure for unit testing.
 */
export function deriveAccountHealth(
    provisioningState: ProvisioningState | undefined,
    hasSustainedThrottling: boolean,
): HealthState {
    if (provisioningState !== undefined && provisioningState !== 'Succeeded') {
        return TRANSITIONAL_PROVISIONING_STATES.has(provisioningState) ? 'Needs Attention' : 'Critical';
    }
    if (hasSustainedThrottling) {
        return 'Critical';
    }
    return 'Healthy';
}

/**
 * Fetches storage, 7-day growth, recent RU peak, and per-row throttling for
 * every container in the account, then folds them into per-row and account-level
 * health. Any failure of the primary storage/RU queries degrades the whole
 * result to `available: false`.
 */
export async function getInventoryMetrics(
    client: MonitorClient,
    resourceUri: string,
    timeRange: TimeRange,
    provisioningState: ProvisioningState | undefined,
    thresholds: HealthThresholds,
): Promise<InventoryMetricsResult> {
    const generatedAt = Date.now();
    const empty = (available: boolean, hasThrottling: boolean, reason?: UnavailableReason): InventoryMetricsResult => ({
        available,
        reason,
        metrics: {},
        accountHealth: deriveAccountHealth(provisioningState, hasThrottling),
        generatedAt,
    });

    const peakConfig = RANGE_CONFIG[timeRange];
    const peakTimespan = `${new Date(generatedAt - peakConfig.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;
    const weekConfig = RANGE_CONFIG['7D'];
    const weekTimespan = `${new Date(generatedAt - weekConfig.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;
    const hourConfig = RANGE_CONFIG['1H'];
    const hourTimespan = `${new Date(generatedAt - hourConfig.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;

    let dataUsage: Map<string, Map<number, number>>;
    let peakRu: Map<string, Map<number, number>>;
    try {
        [dataUsage, peakRu] = await Promise.all([
            querySplitMaxSeries(client, resourceUri, 'DataUsage', weekTimespan, weekConfig.interval),
            querySplitMaxSeries(client, resourceUri, 'NormalizedRUConsumption', peakTimespan, peakConfig.interval),
        ]);
    } catch (error) {
        return empty(false, false, classifyUnavailable(error));
    }

    if (dataUsage.size === 0 && peakRu.size === 0) {
        return empty(false, false, 'noData');
    }

    // Index storage and throttling are best-effort; missing data must not sink the row.
    let indexUsage = new Map<string, Map<number, number>>();
    try {
        indexUsage = await querySplitMaxSeries(client, resourceUri, 'IndexUsage', weekTimespan, weekConfig.interval);
    } catch {
        // ignore
    }

    let throttledContainers = new Set<string>();
    try {
        throttledContainers = await queryThrottlingByContainer(
            client,
            resourceUri,
            hourTimespan,
            hourConfig.interval,
            hourConfig.bucketMs,
        );
    } catch {
        // ignore
    }

    const keys = new Set<string>([...dataUsage.keys(), ...peakRu.keys(), ...indexUsage.keys()]);
    const metrics: Record<string, ContainerMetrics> = {};

    for (const key of keys) {
        const slash = key.indexOf('/');
        const databaseId = slash >= 0 ? key.slice(0, slash) : '';
        const containerId = slash >= 0 ? key.slice(slash + 1) : key;

        const dataSeries = dataUsage.get(key);
        const indexSeries = indexUsage.get(key);
        const ruSeries = peakRu.get(key);

        const latestData = dataSeries ? lastValue(dataSeries) : undefined;
        const latestIndex = indexSeries ? lastValue(indexSeries) : undefined;
        const storageBytes =
            latestData !== undefined || latestIndex !== undefined ? (latestData ?? 0) + (latestIndex ?? 0) : undefined;

        let storageGrowthBytes: number | undefined;
        if (dataSeries) {
            const first = firstValue(dataSeries);
            const last = lastValue(dataSeries);
            if (first !== undefined && last !== undefined) {
                storageGrowthBytes = last - first;
            }
        }

        const peakRuPercent = ruSeries && ruSeries.size > 0 ? Math.max(...ruSeries.values()) : undefined;
        const throttled = throttledContainers.has(key);

        const partial = { storageBytes, storageGrowthBytes, peakRuPercent, throttled };
        metrics[key] = {
            databaseId,
            containerId,
            ...partial,
            dataUsageBytes: latestData,
            indexUsageBytes: latestIndex,
            health: deriveRowHealth(partial, thresholds),
        };
    }

    return {
        available: true,
        metrics,
        accountHealth: deriveAccountHealth(provisioningState, throttledContainers.size > 0),
        generatedAt,
    };
}

/**
 * Reads a metric's max aggregation split by the `DatabaseName`/`CollectionName`
 * dimensions into a `containerKey → (timestamp → value)` map.
 */
async function querySplitMaxSeries(
    client: MonitorClient,
    resourceUri: string,
    metricName: string,
    timespan: string,
    interval: string,
): Promise<Map<string, Map<number, number>>> {
    const response = await client.metrics.list(resourceUri, {
        metricnames: metricName,
        aggregation: 'Maximum',
        timespan,
        interval,
        filter: `DatabaseName eq '*' and CollectionName eq '*'`,
    });

    const byContainer = new Map<string, Map<number, number>>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            const key = seriesContainerKey(series.metadatavalues);
            if (!key) {
                continue;
            }
            const buckets = byContainer.get(key) ?? new Map<number, number>();
            for (const point of series.data ?? []) {
                if (point.maximum === undefined) {
                    continue;
                }
                const ts = new Date(point.timeStamp).getTime();
                buckets.set(ts, Math.max(buckets.get(ts) ?? 0, point.maximum));
            }
            byContainer.set(key, buckets);
        }
    }
    return byContainer;
}

/**
 * Determines which containers saw sustained throttling over the window by
 * splitting `TotalRequests` on `DatabaseName`/`CollectionName`/`StatusCode` and
 * running the same contiguous-run detection used at the account level.
 */
async function queryThrottlingByContainer(
    client: MonitorClient,
    resourceUri: string,
    timespan: string,
    interval: string,
    bucketMs: number,
): Promise<Set<string>> {
    const response = await client.metrics.list(resourceUri, {
        metricnames: 'TotalRequests',
        aggregation: 'Total',
        timespan,
        interval,
        filter: `DatabaseName eq '*' and CollectionName eq '*' and StatusCode eq '*'`,
    });

    // containerKey → (timestamp → { total, throttled })
    const perContainer = new Map<string, Map<number, { total: number; throttled: number }>>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            const key = seriesContainerKey(series.metadatavalues);
            if (!key) {
                continue;
            }
            const statusCode = series.metadatavalues?.find((m) => m.name?.value?.toLowerCase() === 'statuscode')?.value;
            const isThrottle = isThrottledStatusCode(statusCode);
            const buckets = perContainer.get(key) ?? new Map<number, { total: number; throttled: number }>();
            for (const point of series.data ?? []) {
                const count = point.total ?? 0;
                if (count === 0) {
                    continue;
                }
                const ts = new Date(point.timeStamp).getTime();
                const entry = buckets.get(ts) ?? { total: 0, throttled: 0 };
                entry.total += count;
                if (isThrottle) {
                    entry.throttled += count;
                }
                buckets.set(ts, entry);
            }
            perContainer.set(key, buckets);
        }
    }

    const throttled = new Set<string>();
    for (const [key, buckets] of perContainer) {
        const overThreshold = [...buckets.entries()]
            .filter(([, v]) => v.total > 0 && v.throttled / v.total > THROTTLING_SHARE_THRESHOLD)
            .map(([ts]) => ts)
            .sort((a, b) => a - b);
        if (sustainedTimestamps(overThreshold, bucketMs).size > 0) {
            throttled.add(key);
        }
    }
    return throttled;
}
