/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient, type TimeSeriesElement } from '@azure/arm-monitor';
import { type MetricScope } from '../metrics/hostFetchers';
import { namedMetricContainerKey } from './inventory';
import { querySeries } from './ruTrends';
import {
    classifyUnavailable,
    containerFilter,
    escapeODataLiteral,
    isThrottledStatusCode,
    RANGE_CONFIG,
    type TimeRange,
    type UnavailableReason,
} from './shared';

export interface ThrottlingAnalytics {
    available: boolean;
    reason?: UnavailableReason;
    /** Percent of measured requests over the selected window, not an average of bucket percentages. */
    ratePercent?: number;
    totalRequests?: number;
    throttledRequests?: number;
}

export interface ConsumedRuAnalytics {
    available: boolean;
    reason?: UnavailableReason;
    /** Peak of TotalRequestUnits / bucket duration. This is not an instantaneous RU/s peak. */
    peakBucketAverageRuPerSecond?: number;
    bucketSeconds: number;
}

export interface ResourceOverviewAnalytics {
    databaseId: string;
    containerId: string;
    throttling: ThrottlingAnalytics;
    consumedRu: ConsumedRuAnalytics;
}

export interface OverviewAnalyticsResult extends MetricScope {
    timeRange: TimeRange;
    generatedAt: number;
    windowStart: number;
    windowEnd: number;
    throttling: ThrottlingAnalytics;
    consumedRu: ConsumedRuAnalytics;
    resources: Record<string, ResourceOverviewAnalytics>;
    /** False when a split query failed, lacked resource dimensions, or reached its series limit. */
    resourcesComplete: boolean;
    resourcesReason?: UnavailableReason;
}

/** Missing status dimensions or no measured requests cannot establish a measured 429 percentage. */
export function aggregateThrottling(series: readonly TimeSeriesElement[]): ThrottlingAnalytics {
    let totalRequests = 0;
    let throttledRequests = 0;
    let hasSamples = false;
    for (const item of series) {
        const status = item.metadatavalues?.find((meta) => meta.name?.value?.toLowerCase() === 'statuscode')?.value;
        for (const point of item.data ?? []) {
            const count = point.total;
            if (count === undefined || !Number.isFinite(count) || count < 0) {
                continue;
            }
            if (!status) {
                return { available: false, reason: 'noData' };
            }
            hasSamples = true;
            totalRequests += count;
            if (isThrottledStatusCode(status)) {
                throttledRequests += count;
            }
        }
    }
    if (!hasSamples) {
        return { available: false, reason: 'noData' };
    }
    return {
        available: totalRequests > 0,
        reason: totalRequests > 0 ? undefined : 'noData',
        totalRequests,
        throttledRequests,
        ratePercent: totalRequests > 0 ? (100 * throttledRequests) / totalRequests : undefined,
    };
}

export function aggregateConsumedRu(buckets: ReadonlyMap<number, number>, bucketSeconds: number): ConsumedRuAnalytics {
    let peak: number | undefined;
    if (Number.isFinite(bucketSeconds) && bucketSeconds > 0) {
        for (const [timestamp, value] of buckets) {
            if (Number.isFinite(timestamp) && Number.isFinite(value) && value >= 0) {
                peak = Math.max(peak ?? 0, value / bucketSeconds);
            }
        }
    }
    return {
        available: peak !== undefined,
        reason: peak === undefined ? 'noData' : undefined,
        peakBucketAverageRuPerSecond: peak,
        bucketSeconds,
    };
}

export function unavailableOverviewAnalytics(
    scope: MetricScope,
    timeRange: TimeRange,
    reason: UnavailableReason,
    generatedAt = Date.now(),
): OverviewAnalyticsResult {
    const config = RANGE_CONFIG[timeRange];
    // Complete buckets prevent partially elapsed buckets from understating consumed RU/s.
    const windowEnd = Math.floor(generatedAt / config.bucketMs) * config.bucketMs;
    return {
        ...scope,
        timeRange,
        generatedAt,
        windowStart: windowEnd - config.windowMs,
        windowEnd,
        throttling: { available: false, reason },
        consumedRu: { available: false, reason, bucketSeconds: config.bucketMs / 1000 },
        resources: {},
        resourcesComplete: false,
        resourcesReason: reason,
    };
}

const SPLIT_SERIES_LIMIT = 10000;

function totalBuckets(series: readonly TimeSeriesElement[]): Map<number, number> {
    const buckets = new Map<number, number>();
    for (const item of series) {
        for (const point of item.data ?? []) {
            const timestamp = new Date(point.timeStamp).getTime();
            if (
                point.total !== undefined &&
                Number.isFinite(point.total) &&
                point.total >= 0 &&
                Number.isFinite(timestamp)
            ) {
                buckets.set(timestamp, (buckets.get(timestamp) ?? 0) + point.total);
            }
        }
    }
    return buckets;
}

/**
 * Opt-in analytics. Separate unsplit queries keep the scoped headline accurate even when a large inventory
 * reaches Azure Monitor's split-series limit. Every query uses the same closed-bucket window.
 */
export async function getOverviewAnalytics(
    client: MonitorClient,
    resourceUri: string,
    scope: MetricScope,
    timeRange: TimeRange,
): Promise<OverviewAnalyticsResult> {
    const result = unavailableOverviewAnalytics(scope, timeRange, 'noData');
    const config = RANGE_CONFIG[timeRange];
    const timespan = `${new Date(result.windowStart).toISOString()}/${new Date(result.windowEnd).toISOString()}`;
    const filter = containerFilter(scope.databaseId, scope.containerId);
    const splitFilter = [
        `DatabaseName eq '${scope.databaseId ? escapeODataLiteral(scope.databaseId) : '*'}'`,
        `CollectionName eq '${scope.containerId ? escapeODataLiteral(scope.containerId) : '*'}'`,
    ].join(' and ');
    const query = async (metricnames: string, metricFilter: string): Promise<TimeSeriesElement[]> => {
        const response = await client.metrics.list(resourceUri, {
            metricnames,
            aggregation: 'Total',
            timespan,
            interval: config.interval,
            filter: metricFilter,
            top: SPLIT_SERIES_LIMIT,
        });
        return (response.value ?? [])
            .flatMap((metric) => metric.timeseries ?? [])
            .map((series) => ({
                ...series,
                data: series.data?.filter((point) => {
                    const timestamp = new Date(point.timeStamp).getTime();
                    return timestamp >= result.windowStart && timestamp < result.windowEnd;
                }),
            }));
    };

    const [requests, consumed, resourceRequests, resourceConsumed] = await Promise.allSettled([
        query('TotalRequests', filter ? `${filter} and StatusCode eq '*'` : `StatusCode eq '*'`),
        querySeries(client, resourceUri, 'TotalRequestUnits', 'Total', timespan, config.interval, filter),
        query('TotalRequests', `${splitFilter} and StatusCode eq '*'`),
        query('TotalRequestUnits', splitFilter),
    ]);

    result.throttling =
        requests.status === 'fulfilled' && requests.value.length < SPLIT_SERIES_LIMIT
            ? aggregateThrottling(requests.value)
            : {
                  available: false,
                  reason: requests.status === 'rejected' ? classifyUnavailable(requests.reason) : 'noData',
              };
    result.consumedRu =
        consumed.status === 'fulfilled'
            ? aggregateConsumedRu(
                  new Map(
                      [...consumed.value].filter(
                          ([timestamp]) => timestamp >= result.windowStart && timestamp < result.windowEnd,
                      ),
                  ),
                  config.bucketMs / 1000,
              )
            : { ...result.consumedRu, reason: classifyUnavailable(consumed.reason) };

    const splitRequests = resourceRequests.status === 'fulfilled' ? resourceRequests.value : [];
    const splitConsumed = resourceConsumed.status === 'fulfilled' ? resourceConsumed.value : [];
    const group = (series: TimeSeriesElement[]): Map<string, TimeSeriesElement[]> => {
        const grouped = new Map<string, TimeSeriesElement[]>();
        for (const item of series) {
            const key = namedMetricContainerKey(item.metadatavalues);
            if (key) {
                const items = grouped.get(key) ?? [];
                items.push(item);
                grouped.set(key, items);
            }
        }
        return grouped;
    };
    const requestGroups = group(splitRequests);
    const consumedGroups = group(splitConsumed);
    result.resourcesComplete =
        resourceRequests.status === 'fulfilled' &&
        resourceConsumed.status === 'fulfilled' &&
        splitRequests.length + splitConsumed.length > 0 &&
        splitRequests.length < SPLIT_SERIES_LIMIT &&
        splitConsumed.length < SPLIT_SERIES_LIMIT &&
        [...splitRequests, ...splitConsumed].every((item) => {
            return namedMetricContainerKey(item.metadatavalues) !== undefined;
        });
    result.resourcesReason = result.resourcesComplete
        ? undefined
        : resourceRequests.status === 'rejected'
          ? classifyUnavailable(resourceRequests.reason)
          : resourceConsumed.status === 'rejected'
            ? classifyUnavailable(resourceConsumed.reason)
            : 'noData';
    for (const key of new Set([...requestGroups.keys(), ...consumedGroups.keys()])) {
        const slash = key.indexOf('/');
        result.resources[key] = {
            databaseId: key.slice(0, slash),
            containerId: key.slice(slash + 1),
            throttling:
                resourceRequests.status === 'rejected' || splitRequests.length >= SPLIT_SERIES_LIMIT
                    ? {
                          available: false,
                          reason:
                              resourceRequests.status === 'rejected'
                                  ? classifyUnavailable(resourceRequests.reason)
                                  : 'noData',
                      }
                    : aggregateThrottling(requestGroups.get(key) ?? []),
            consumedRu:
                resourceConsumed.status === 'rejected' || splitConsumed.length >= SPLIT_SERIES_LIMIT
                    ? {
                          available: false,
                          bucketSeconds: config.bucketMs / 1000,
                          reason:
                              resourceConsumed.status === 'rejected'
                                  ? classifyUnavailable(resourceConsumed.reason)
                                  : 'noData',
                      }
                    : aggregateConsumedRu(totalBuckets(consumedGroups.get(key) ?? []), config.bucketMs / 1000),
        };
    }
    return result;
}
