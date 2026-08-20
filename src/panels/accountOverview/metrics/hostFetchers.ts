/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { querySeries, queryThrottlingWindows } from '../services/ruTrends';
import {
    classifyUnavailable,
    containerFilter,
    effectiveInterval,
    escapeODataLiteral,
    type MetricAggregation,
    type MetricGranularity,
    pickPointValue,
    RANGE_CONFIG,
    seriesContainerKey,
    type TimeRange,
} from '../services/shared';
import { type MetricKey, type MetricPoint, type MetricSeriesResult } from './contracts';

// ─── Host fetcher registry — "one server per metric type" ───────────────────────
//
// Each metric resolves to a host-side fetcher that turns an Azure Monitor query
// into the neutral `MetricSeriesResult` wire shape. Most metrics need nothing but
// a metric name + aggregation, so they share the descriptor-driven `genericSeries`
// fetcher; the few that need extra signal (throttling overlay) register an
// override. A metric that reads more than one Azure Monitor series (server-side
// latency across Direct + Gateway, data + index storage) lists them in `SPECS`
// and the generic fetcher combines them. Adding a typical metric later is a
// one-line `SPECS` entry — the generic fetcher picks it up automatically.

/** Account-wide (both undefined) or container-scoped Azure Monitor query. */
export interface MetricScope {
    databaseId?: string;
    containerId?: string;
}

/** How a metric's multiple Azure Monitor series collapse into one per-bucket value. */
type Combine = 'max' | 'sum';

interface HostMetricSpec {
    /** One or more Azure Monitor metric names read for this metric, combined via {@link HostMetricSpec.combine}. */
    metricNames: string[];
    aggregation: MetricAggregation;
    /** How multiple `metricNames` merge per bucket. `max` (default) suits parallel signals (latency modes); `sum` totals additive parts (data + index). */
    combine?: Combine;
    /** True for account-scoped metrics with no `CollectionName`/`DatabaseName` dimension (e.g. `ServiceAvailability`) — never filtered to a container. */
    accountOnly?: boolean;
    /** Coarsest grain the metric is emitted at; the range interval is floored to it (see {@link effectiveInterval}). */
    minInterval?: MetricGranularity;
}

/**
 * The Azure Monitor metric name(s) + aggregation each metric reads, verified
 * against the `Microsoft.DocumentDB/databaseAccounts` supported-metrics reference:
 *
 * - `serverLatency` reads the current `ServerSideLatencyDirect` + `ServerSideLatencyGateway`
 *   pair (the flat `ServerSideLatency` was deprecated/removed in 2025) and shows the worse of the two.
 * - `totalRequestUnits` (consumed RU) and `metadataRequests` (control-plane calls, not part of
 *   `TotalRequests`) are additive request-path counters read with `Total`, like `totalRequests`.
 * - `serviceAvailability` is account-only and emitted only at `PT1H`.
 * - `dataIndexUsage` sums `DataUsage` + `IndexUsage`; both start at `PT5M`.
 * - `documentCount` reads `DocumentCountV2` (the flat `DocumentCount` is deprecated) with `Maximum`. It is a
 *   per-collection snapshot gauge (documents currently stored, replicated per region), not an additive counter,
 *   so it uses a dedicated {@link documentCountFetcher} that splits by collection and sums each collection's
 *   latest value rather than the flat `genericSeries` read — see that function for why `Total`/an unsplit query
 *   would drift with the selected window.
 *
 * An API/SKU that never emits a metric degrades to an `available: false` empty-state rather than an error.
 */
const SPECS: Record<MetricKey, HostMetricSpec> = {
    normalizedRu: { metricNames: ['NormalizedRUConsumption'], aggregation: 'Maximum' },
    totalRequests: { metricNames: ['TotalRequests'], aggregation: 'Total' },
    totalRequestUnits: { metricNames: ['TotalRequestUnits'], aggregation: 'Total' },
    metadataRequests: { metricNames: ['MetadataRequests'], aggregation: 'Total' },
    serverLatency: {
        metricNames: ['ServerSideLatencyDirect', 'ServerSideLatencyGateway'],
        aggregation: 'Average',
        combine: 'max',
    },
    serviceAvailability: {
        metricNames: ['ServiceAvailability'],
        aggregation: 'Average',
        accountOnly: true,
        minInterval: 'PT1H',
    },
    dataIndexUsage: {
        metricNames: ['DataUsage', 'IndexUsage'],
        aggregation: 'Maximum',
        combine: 'sum',
        minInterval: 'PT5M',
    },
    provisionedThroughput: { metricNames: ['ProvisionedThroughput'], aggregation: 'Maximum', minInterval: 'PT5M' },
    documentCount: { metricNames: ['DocumentCountV2'], aggregation: 'Maximum', minInterval: 'PT5M' },
};

type MetricFetcher = (
    client: MonitorClient,
    resourceUri: string,
    scope: MetricScope,
    range: TimeRange,
) => Promise<MetricSeriesResult>;

function baseResult(metric: MetricKey, scope: MetricScope, range: TimeRange): MetricSeriesResult {
    return {
        metric,
        available: false,
        points: [],
        timeRange: range,
        databaseId: scope.databaseId,
        containerId: scope.containerId,
        generatedAt: Date.now(),
    };
}

/** Merges several `timestamp → value` maps into one, combining bucket collisions by `combine`. */
function mergeBuckets(maps: Map<number, number>[], combine: Combine): Map<number, number> {
    const out = new Map<number, number>();
    for (const map of maps) {
        for (const [ts, value] of map) {
            const prev = out.get(ts);
            if (prev === undefined) {
                out.set(ts, value);
            } else {
                out.set(ts, combine === 'sum' ? prev + value : Math.max(prev, value));
            }
        }
    }
    return out;
}

/** Merges a `timestamp → value` map (and optional throttled set) into sorted points + peak. */
function toPoints(buckets: Map<number, number>, throttled?: Set<number>): { points: MetricPoint[]; peak?: number } {
    const points: MetricPoint[] = [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([timestamp, value]) => ({
            timestamp,
            value,
            throttled: throttled ? throttled.has(timestamp) : undefined,
        }));
    const peak = points.reduce<number | undefined>(
        (max, p) => (p.value === undefined ? max : Math.max(max ?? 0, p.value)),
        undefined,
    );
    return { points, peak };
}

/**
 * Descriptor-driven fetcher: reads every metric name in `SPECS[metric]` (flooring
 * the range interval to the metric's coarsest grain and dropping the container
 * filter for account-only metrics), then combines the series per bucket.
 */
function genericSeries(metric: MetricKey): MetricFetcher {
    const spec = SPECS[metric];
    const combine = spec.combine ?? 'max';
    return async (client, resourceUri, scope, range) => {
        const config = RANGE_CONFIG[range];
        const interval = effectiveInterval(config.interval, spec.minInterval);
        const end = Date.now();
        const timespan = `${new Date(end - config.windowMs).toISOString()}/${new Date(end).toISOString()}`;
        const filter = spec.accountOnly ? undefined : containerFilter(scope.databaseId, scope.containerId);
        const base = baseResult(metric, scope, range);

        let maps: Map<number, number>[];
        try {
            maps = await Promise.all(
                spec.metricNames.map((name) =>
                    querySeries(client, resourceUri, name, spec.aggregation, timespan, interval, filter),
                ),
            );
        } catch (error) {
            return { ...base, reason: classifyUnavailable(error) };
        }
        const buckets = mergeBuckets(maps, combine);
        if (buckets.size === 0) {
            return { ...base, reason: 'noData' };
        }
        const { points, peak } = toPoints(buckets);
        return { ...base, available: true, points, peak };
    };
}

/**
 * `normalizedRu` and `totalRequests` both overlay sustained-throttling (429)
 * windows on their series. The RU provider reads its own metric; the requests
 * provider reads the same `TotalRequests` volume. The throttling overlay is
 * best-effort — a failure keeps the primary series.
 */
function withThrottling(metric: MetricKey): MetricFetcher {
    const generic = genericSeries(metric);
    return async (client, resourceUri, scope, range) => {
        const result = await generic(client, resourceUri, scope, range);
        if (!result.available) {
            return result;
        }
        const config = RANGE_CONFIG[range];
        const end = Date.now();
        const timespan = `${new Date(end - config.windowMs).toISOString()}/${new Date(end).toISOString()}`;
        const filter = containerFilter(scope.databaseId, scope.containerId);

        let throttled = new Set<number>();
        try {
            throttled = await queryThrottlingWindows(
                client,
                resourceUri,
                timespan,
                config.interval,
                config.bucketMs,
                filter,
            );
        } catch {
            // Overlay is best-effort; keep the primary series even if it fails.
        }
        const points = result.points.map((p) => ({ ...p, throttled: throttled.has(p.timestamp) }));
        return { ...result, points };
    };
}

/**
 * Sums per-collection snapshot series into one account trend. Each collection
 * reports its document count independently (and at slightly staggered
 * timestamps), so a naive per-timestamp sum would only count the collections that
 * happened to report in that exact bucket. Instead we walk the merged timeline and,
 * at every timestamp, add each collection's most recent value (forward-filled).
 * The final bucket is therefore the sum of every collection's latest count.
 */
function sumForwardFilled(perCollection: Map<string, Map<number, number>>): Map<number, number> {
    const cols = [...perCollection.values()].map((series) => ({
        entries: [...series.entries()].sort((a, b) => a[0] - b[0]),
        idx: 0,
        last: undefined as number | undefined,
    }));
    const timestamps = [...new Set(cols.flatMap((c) => c.entries.map(([ts]) => ts)))].sort((a, b) => a - b);

    const out = new Map<number, number>();
    for (const ts of timestamps) {
        let sum = 0;
        let seen = false;
        for (const col of cols) {
            while (col.idx < col.entries.length && col.entries[col.idx][0] <= ts) {
                col.last = col.entries[col.idx][1];
                col.idx++;
            }
            if (col.last !== undefined) {
                sum += col.last;
                seen = true;
            }
        }
        if (seen) {
            out.set(ts, sum);
        }
    }
    return out;
}

/**
 * `documentCount` needs a dedicated fetcher rather than the flat `genericSeries`
 * read. `DocumentCountV2` is a per-collection snapshot gauge, split again by
 * `Region` on geo-replicated accounts. An unsplit account query collapses those
 * dimensions with a single aggregation, so `Maximum` reports only the largest one
 * collection (undercount) and `Total` sums every raw sample in the interval plus
 * every region (overcount) — both drift with the selected window/grain. Instead we
 * split by `DatabaseName`/`CollectionName`, fold each collection's regions with
 * `max` (replicas carry the same count, so summing double-counts), then sum each
 * collection's latest value across the timeline via {@link sumForwardFilled}. The
 * latest bucket is thus the true account total, independent of the chosen range.
 */
function documentCountFetcher(): MetricFetcher {
    const spec = SPECS.documentCount;
    return async (client, resourceUri, scope, range) => {
        const config = RANGE_CONFIG[range];
        const interval = effectiveInterval(config.interval, spec.minInterval);
        const end = Date.now();
        const timespan = `${new Date(end - config.windowMs).toISOString()}/${new Date(end).toISOString()}`;
        const base = baseResult('documentCount', scope, range);
        // Split on the container dimensions: a specific container when drilled in, every collection in the
        // selected database when scoped to a database, otherwise every collection in the account.
        const filter = scope.containerId
            ? containerFilter(scope.databaseId, scope.containerId)
            : scope.databaseId
              ? `DatabaseName eq '${escapeODataLiteral(scope.databaseId)}' and CollectionName eq '*'`
              : `DatabaseName eq '*' and CollectionName eq '*'`;

        let response: Awaited<ReturnType<MonitorClient['metrics']['list']>>;
        try {
            response = await client.metrics.list(resourceUri, {
                metricnames: spec.metricNames[0],
                aggregation: spec.aggregation,
                timespan,
                interval,
                filter,
            });
        } catch (error) {
            return { ...base, reason: classifyUnavailable(error) };
        }

        // Per-collection `timestamp → count`, folding a collection's regions with `max` (replicas share the count).
        const perCollection = new Map<string, Map<number, number>>();
        for (const metric of response.value ?? []) {
            for (const series of metric.timeseries ?? []) {
                const key = seriesContainerKey(series.metadatavalues) ?? '';
                const counts = perCollection.get(key) ?? new Map<number, number>();
                for (const point of series.data ?? []) {
                    const value = pickPointValue(point, spec.aggregation);
                    if (value === undefined) {
                        continue;
                    }
                    const ts = new Date(point.timeStamp).getTime();
                    counts.set(ts, Math.max(counts.get(ts) ?? 0, value));
                }
                perCollection.set(key, counts);
            }
        }
        if (perCollection.size === 0) {
            return { ...base, reason: 'noData' };
        }

        const { points, peak } = toPoints(sumForwardFilled(perCollection));
        if (points.length === 0) {
            return { ...base, reason: 'noData' };
        }
        return { ...base, available: true, points, peak };
    };
}

const FETCHERS: Record<MetricKey, MetricFetcher> = {
    normalizedRu: withThrottling('normalizedRu'),
    totalRequests: withThrottling('totalRequests'),
    totalRequestUnits: genericSeries('totalRequestUnits'),
    metadataRequests: genericSeries('metadataRequests'),
    serverLatency: genericSeries('serverLatency'),
    serviceAvailability: genericSeries('serviceAvailability'),
    dataIndexUsage: genericSeries('dataIndexUsage'),
    provisionedThroughput: genericSeries('provisionedThroughput'),
    documentCount: documentCountFetcher(),
};

/**
 * Fetches a metric's series for the given scope + range. Dispatches to the metric's
 * registered fetcher (generic descriptor-driven read, or an override for the few
 * metrics that need extra signal). Never throws — Azure Monitor failures resolve to
 * an `available: false` result so the webview renders an explicit empty-state.
 */
export function fetchMetricSeries(
    metric: MetricKey,
    client: MonitorClient,
    resourceUri: string,
    scope: MetricScope,
    range: TimeRange,
): Promise<MetricSeriesResult> {
    return FETCHERS[metric](client, resourceUri, scope, range);
}
