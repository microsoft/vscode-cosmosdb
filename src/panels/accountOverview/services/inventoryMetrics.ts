/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { getMetricApplicability } from '../metrics/contracts';
import { storageObservation, type StorageMeasurement } from '../metrics/storage';
import { DIAGNOSTIC_POLICY } from './advisories/core/thresholds';
import {
    classifyUnavailable,
    firstValue,
    type HealthState,
    isThrottledStatusCode,
    lastValue,
    metricFailureReason,
    parseMonitorTimestamp,
    pickPointValue,
    RANGE_CONFIG,
    type RangeConfig,
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
// dimensions, then keyed back to individual containers. Primary storage/RU failures
// set `available: false` while independent observations remain usable.
// Storage retains each component's value or failure reason; callers distinguish partial sums from complete totals.

/** Per-row health thresholds, sourced from `cosmosDB.accountOverview.*`. */
export interface HealthThresholds {
    /** Peak normalized RU % at or above which a row is Critical. */
    criticalRuPercent: number;
    /** Peak normalized RU % at or above which a row Needs Attention. */
    warningRuPercent: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
    criticalRuPercent: DIAGNOSTIC_POLICY.health.criticalRuPercent,
    warningRuPercent: DIAGNOSTIC_POLICY.health.warningRuPercent,
};

export interface ContainerMetrics {
    databaseId: string;
    containerId: string;
    /** Latest observations for data and index storage, with independent unavailable reasons. */
    storage: StorageMeasurement;
    /** `DataUsage` delta between the first and last datapoint over 7 days, in bytes. */
    storageGrowthBytes?: number;
    /** `max(NormalizedRUConsumption)` over the selected window (percentage). */
    peakRuPercent?: number;
    /** Latest `DocumentCountV2` for the container, when reported. */
    documentCount?: number;
    /** Downsampled 7-day `DataUsage` series (oldest → newest, in bytes) for the storage sparkline. */
    storageSparkline?: number[];
    /** Downsampled `NormalizedRUConsumption` series (oldest → newest, percent) for the RU sparkline. */
    ruSparkline?: number[];
    /** True when the container saw sustained throttling in the last hour. */
    throttled: boolean;
    health?: HealthState;
}

export interface InventoryMetricsResult {
    /** False when a primary storage/RU query failed or Azure Monitor returned no container series. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    /** Per-container metrics keyed as `${databaseId}/${containerId}`. */
    metrics: Record<string, ContainerMetrics>;
    /** Account health supplied by the router from provisioning and per-container throttling. */
    accountHealth?: HealthState;
    /** Reasons for containers absent from the metric response (including when all reads failed). */
    storageFallback?: StorageMeasurement;
    /** Epoch milliseconds when the server produced this snapshot. */
    generatedAt: number;
}

/**
 * Derives per-row health from the collected metrics and configured thresholds.
 * Storage growth no longer feeds row health — absolute bytes-added is
 * uncorrelated with risk, so proximity to the per-partition limit is surfaced by
 * the StorageGrowthRisk derived advisory instead. Pure so it can be unit-tested
 * against synthetic metrics.
 */
export function deriveRowHealth(
    metrics: Pick<ContainerMetrics, 'peakRuPercent' | 'throttled'>,
    thresholds: HealthThresholds,
): HealthState | undefined {
    const peak = metrics.peakRuPercent;
    if (metrics.throttled || (peak !== undefined && peak >= thresholds.criticalRuPercent)) {
        return 'Critical';
    }
    if (peak !== undefined && peak >= thresholds.warningRuPercent) {
        return 'Needs Attention';
    }
    return peak === undefined ? undefined : 'Healthy';
}

/**
 * Fetches storage, 7-day growth, recent RU peak, and per-row throttling for
 * every container in the account.
 * A primary storage/RU failure sets `available: false` but retains independent observations and 429 signals.
 * Diagnostic callers supply `peakConfig`; chart callers keep the time-range preset for RU.
 */
export async function getInventoryMetrics(
    client: MonitorClient,
    resourceUri: string,
    timeRange: TimeRange,
    thresholds: HealthThresholds,
    peakConfig: RangeConfig = RANGE_CONFIG[timeRange],
    isServerless = false,
): Promise<InventoryMetricsResult> {
    const generatedAt = Date.now();
    const normalizedRuApplicable = getMetricApplicability('normalizedRu', isServerless).status === 'applicable';

    const peakTimespan = `${new Date(generatedAt - peakConfig.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;
    const weekConfig = DIAGNOSTIC_POLICY.inventoryStorage.observation;
    const weekTimespan = `${new Date(generatedAt - weekConfig.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;
    const hourConfig = DIAGNOSTIC_POLICY.sustainedThrottling.observation;
    const hourTimespan = `${new Date(generatedAt - hourConfig.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;

    const [storageOutcome, ruOutcome, indexOutcome] = await Promise.allSettled([
        querySplitSeries(client, resourceUri, 'DataUsage', weekTimespan, weekConfig.interval),
        normalizedRuApplicable
            ? querySplitSeries(client, resourceUri, 'NormalizedRUConsumption', peakTimespan, peakConfig.interval)
            : Promise.resolve(new Map<string, Map<number, number>>()),
        querySplitSeries(client, resourceUri, 'IndexUsage', weekTimespan, weekConfig.interval),
    ]);
    const dataUsage =
        storageOutcome.status === 'fulfilled' ? storageOutcome.value : new Map<string, Map<number, number>>();
    const peakRu = ruOutcome.status === 'fulfilled' ? ruOutcome.value : new Map<string, Map<number, number>>();
    const failure = [storageOutcome, ruOutcome].find((outcome) => outcome.status === 'rejected');
    const reason = failure?.status === 'rejected' ? classifyUnavailable(failure.reason) : undefined;

    const indexUsage =
        indexOutcome.status === 'fulfilled' ? indexOutcome.value : new Map<string, Map<number, number>>();
    const dataReason = storageOutcome.status === 'rejected' ? metricFailureReason(storageOutcome.reason) : 'noData';
    const indexReason = indexOutcome.status === 'rejected' ? metricFailureReason(indexOutcome.reason) : 'noData';
    const storageFallback: StorageMeasurement = {
        data: { status: 'unavailable', reason: dataReason },
        index: { status: 'unavailable', reason: indexReason },
    };

    // Document count is best-effort. `DocumentCountV2` is a snapshot gauge (documents currently stored, replicated
    // per region), so it is read with `Maximum` (the default): `Total` would sum every raw sample inside an interval
    // bucket (inflating the count as the window grows) and double-count regions. The latest bucket's value is the count.
    let documentCount = new Map<string, Map<number, number>>();
    try {
        documentCount = await querySplitSeries(
            client,
            resourceUri,
            'DocumentCountV2',
            weekTimespan,
            weekConfig.interval,
        );
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

    const keys = new Set<string>([
        ...dataUsage.keys(),
        ...peakRu.keys(),
        ...indexUsage.keys(),
        ...documentCount.keys(),
        ...throttledContainers,
    ]);
    const metrics: Record<string, ContainerMetrics> = {};

    for (const key of keys) {
        const slash = key.indexOf('/');
        const databaseId = slash >= 0 ? key.slice(0, slash) : '';
        const containerId = slash >= 0 ? key.slice(slash + 1) : key;

        const dataSeries = dataUsage.get(key);
        const indexSeries = indexUsage.get(key);
        const ruSeries = peakRu.get(key);
        const docSeries = documentCount.get(key);

        const storage: StorageMeasurement = {
            data: dataSeries ? storageObservation(dataSeries) : storageFallback.data,
            index: indexSeries ? storageObservation(indexSeries) : storageFallback.index,
        };

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

        const partial = { storage, storageGrowthBytes, peakRuPercent, throttled };
        metrics[key] = {
            databaseId,
            containerId,
            ...partial,
            documentCount: docSeries ? lastValue(docSeries) : undefined,
            storageSparkline: toSparkline(dataSeries),
            ruSparkline: toSparkline(ruSeries),
            health: deriveRowHealth(partial, thresholds),
        };
    }

    return {
        available: reason === undefined && keys.size > 0,
        reason: reason ?? (keys.size === 0 ? 'noData' : undefined),
        metrics,
        storageFallback,
        generatedAt,
    };
}

/**
 * Reads a metric split by the `DatabaseName`/`CollectionName` dimensions into a
 * `containerKey → (timestamp → value)` map, picking each bucket's `Maximum`. This
 * suits both storage/RU peaks and snapshot gauges (document count), where the
 * latest bucket's value is the current reading and colliding regions are folded
 * with `max` rather than summed (which would double-count replicated data).
 */
async function querySplitSeries(
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
        if (metric.errorCode && metric.errorCode !== 'Success') {
            throw new Error(metric.errorMessage ?? metric.errorCode);
        }
        for (const series of metric.timeseries ?? []) {
            const key = seriesContainerKey(series.metadatavalues);
            if (!key) {
                continue;
            }
            const buckets = byContainer.get(key) ?? new Map<number, number>();
            for (const point of series.data ?? []) {
                const value = pickPointValue(point, 'Maximum');
                if (value === undefined) {
                    continue;
                }
                const ts = parseMonitorTimestamp(point.timeStamp);
                if (ts === undefined) {
                    continue;
                }
                const prev = buckets.get(ts);
                buckets.set(ts, prev === undefined ? value : Math.max(prev, value));
            }
            byContainer.set(key, buckets);
        }
    }
    return byContainer;
}

/** Downsamples a `timestamp → value` series to at most `maxPoints` values, oldest → newest, for a sparkline. */
function toSparkline(series: Map<number, number> | undefined, maxPoints = 24): number[] | undefined {
    if (!series || series.size === 0) {
        return undefined;
    }
    const values = [...series.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
    if (values.length <= maxPoints) {
        return values;
    }
    // Sample across `values.length - 1` so the first and newest points are always kept; a plain
    // `i * (len / maxPoints)` floor can drop the latest datapoint, hiding the current value.
    const step = (values.length - 1) / (maxPoints - 1);
    const out: number[] = [];
    for (let i = 0; i < maxPoints; i++) {
        out.push(values[Math.round(i * step)]);
    }
    return out;
}

/**
 * Determines which containers saw sustained throttling over the window by
 * splitting `TotalRequests` on `DatabaseName`/`CollectionName`/`StatusCode` and
 * running the same Count-based contiguous-run detection used at the account level.
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
        aggregation: 'Count',
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
                const count = pickPointValue(point, 'Count');
                if (count === undefined) {
                    continue;
                }
                const ts = parseMonitorTimestamp(point.timeStamp);
                if (ts === undefined) {
                    continue;
                }
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
