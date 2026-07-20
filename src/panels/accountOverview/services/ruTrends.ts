/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import {
    classifyUnavailable,
    containerFilter,
    isThrottledStatusCode,
    pickPointValue,
    RANGE_CONFIG,
    sustainedTimestamps,
    THROTTLING_SHARE_THRESHOLD,
    type MetricAggregation,
    type TimeRange,
    type UnavailableReason,
} from './shared';

// ─── RU usage trends ────────────────────────────────────────────────────────────
//
// Account-level RU utilization trend fed by Azure Monitor. The foreground
// series is `NormalizedRUConsumption` (max aggregation) — already a percentage,
// so no division by provisioned RU is needed. Sustained-throttling windows are derived from `TotalRequests` split by
// `StatusCode`, flagging buckets where the 429 share crosses a threshold for at
// least a few minutes.

export interface RuTrendPoint {
    /** Epoch milliseconds for the bucket. */
    timestamp: number;
    /** `NormalizedRUConsumption` max for the bucket (percentage), when present. */
    ruPercent?: number;
    /** True when the 429 share for the bucket qualifies as sustained throttling. */
    throttled: boolean;
}

export interface RuTrendsResult {
    /** False when Azure Monitor returned no usable series for this API/SKU. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    points: RuTrendPoint[];
    /** Reference line for the provisioned ceiling, expressed on the same axis (100%). */
    provisionedPercent: number;
    /** Max `ruPercent` across the window, for the summary card. */
    peakPercent?: number;
    timeRange: TimeRange;
    databaseId?: string;
    containerId?: string;
    /** Epoch milliseconds when the server produced this snapshot. */
    generatedAt: number;
}

/**
 * Fetches `NormalizedRUConsumption` (max) and merges in throttling windows
 * derived from `TotalRequests` split by `StatusCode`. Any Azure Monitor failure
 * (unsupported API/SKU, missing dimension) resolves to `available: false` so the
 * webview can render an explicit empty-state rather than surfacing an error.
 */
export async function getRuTrends(
    client: MonitorClient,
    resourceUri: string,
    timeRange: TimeRange,
    databaseId: string | undefined,
    containerId: string | undefined,
): Promise<RuTrendsResult> {
    const config = RANGE_CONFIG[timeRange];
    const end = Date.now();
    const start = end - config.windowMs;
    const timespan = `${new Date(start).toISOString()}/${new Date(end).toISOString()}`;
    const filter = containerFilter(databaseId, containerId);

    const base: RuTrendsResult = {
        available: false,
        points: [],
        provisionedPercent: 100,
        timeRange,
        databaseId,
        containerId,
        generatedAt: end,
    };

    let ruBuckets: Map<number, number>;
    try {
        ruBuckets = await querySeries(
            client,
            resourceUri,
            'NormalizedRUConsumption',
            'Maximum',
            timespan,
            config.interval,
            filter,
        );
    } catch (error) {
        return { ...base, reason: classifyUnavailable(error) };
    }

    if (ruBuckets.size === 0) {
        return { ...base, reason: 'noData' };
    }

    let throttledTimestamps = new Set<number>();
    try {
        throttledTimestamps = await queryThrottlingWindows(
            client,
            resourceUri,
            timespan,
            config.interval,
            config.bucketMs,
            filter,
        );
    } catch {
        // Throttling overlay is best-effort; keep the RU series even if it fails.
    }

    const points: RuTrendPoint[] = [...ruBuckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([timestamp, ruPercent]) => ({
            timestamp,
            ruPercent,
            throttled: throttledTimestamps.has(timestamp),
        }));

    const peakPercent = points.reduce<number | undefined>(
        (max, p) => (p.ruPercent === undefined ? max : Math.max(max ?? 0, p.ruPercent)),
        undefined,
    );

    return { ...base, available: true, points, peakPercent };
}

/**
 * Reads a single metric aggregation into a `timestamp → value` map. Generalizes
 * the former max-only reader: the aggregation selects both the Azure Monitor
 * `aggregation` parameter and, via {@link pickPointValue}, which datapoint field
 * to read. Buckets that collide across series are merged by the aggregation's
 * natural combiner (`Total` sums, everything else takes the max — account/
 * container-scoped queries return a single series, so collisions are rare).
 */
export async function querySeries(
    client: MonitorClient,
    resourceUri: string,
    metricName: string,
    aggregation: MetricAggregation,
    timespan: string,
    interval: string,
    filter: string | undefined,
): Promise<Map<number, number>> {
    const response = await client.metrics.list(resourceUri, {
        metricnames: metricName,
        aggregation,
        timespan,
        interval,
        filter,
    });

    const buckets = new Map<number, number>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            for (const point of series.data ?? []) {
                const value = pickPointValue(point, aggregation);
                if (value === undefined) {
                    continue;
                }
                const ts = new Date(point.timeStamp).getTime();
                const prev = buckets.get(ts);
                if (prev === undefined) {
                    buckets.set(ts, value);
                } else {
                    buckets.set(ts, aggregation === 'Total' ? prev + value : Math.max(prev, value));
                }
            }
        }
    }
    return buckets;
}

/**
 * Derives sustained-throttling timestamps from `TotalRequests` split by
 * `StatusCode`: per bucket, `429 share = 429 count / total count`. Buckets over
 * the threshold that form a contiguous run of at least
 * {@link MIN_THROTTLING_DURATION_MS} are reported.
 */
export async function queryThrottlingWindows(
    client: MonitorClient,
    resourceUri: string,
    timespan: string,
    interval: string,
    bucketMs: number,
    filter: string | undefined,
): Promise<Set<number>> {
    const statusFilter = filter ? `${filter} and StatusCode eq '*'` : `StatusCode eq '*'`;
    const response = await client.metrics.list(resourceUri, {
        metricnames: 'TotalRequests',
        aggregation: 'Total',
        timespan,
        interval,
        filter: statusFilter,
    });

    const totals = new Map<number, { total: number; throttled: number }>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            const statusCode = series.metadatavalues?.find((m) => m.name?.value?.toLowerCase() === 'statuscode')?.value;
            const isThrottle = isThrottledStatusCode(statusCode);
            for (const point of series.data ?? []) {
                const count = point.total ?? 0;
                if (count === 0) {
                    continue;
                }
                const ts = new Date(point.timeStamp).getTime();
                const entry = totals.get(ts) ?? { total: 0, throttled: 0 };
                entry.total += count;
                if (isThrottle) {
                    entry.throttled += count;
                }
                totals.set(ts, entry);
            }
        }
    }

    const overThreshold = [...totals.entries()]
        .filter(([, v]) => v.total > 0 && v.throttled / v.total > THROTTLING_SHARE_THRESHOLD)
        .map(([ts]) => ts)
        .sort((a, b) => a - b);

    return sustainedTimestamps(overThreshold, bucketMs);
}
