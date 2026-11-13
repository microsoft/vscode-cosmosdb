/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { readMetrics } from '../../readDiagnostics';
import { querySeries } from '../../ruTrends';
import {
    containerFilter,
    parseMonitorTimestamp,
    pickPointValue,
    requestMetricFilter,
    throughputOfferFilter,
    type MetricAggregation,
    type RangeConfig,
} from '../../shared';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';

// ─── Batch-2 derived-advisory metric fetchers ─────────────────────────────────────
//
// The metrics-based Tier-1 detectors (DX-004 idle, DX-009 partition-merge, DX-011 autoscale-max, DX-013
// autoscale→manual, DX-014 serverless) each need an Azure Monitor query path the rest of the dashboard does not
// already fetch. Idle reads 30 days in five-minute buckets so periodic workloads are not mistaken for idle;
// autoscale/serverless use hourly buckets, while partition-merge reads the most recent six hours.
// All series are read as `Total`/`Maximum` and folded to per-container (or account-total) shapes the pure
// evaluators consume. Failed reads remain incomplete coverage; only DX-004 treats successful empty consumption as idle.

/** Builds the `start/end` ISO-8601 timespan for a diagnostic observation ending now. */
function advisoryTimespan(observation: RangeConfig, now = Date.now()): string {
    const start = now - observation.windowMs;
    return `${new Date(start).toISOString()}/${new Date(now).toISOString()}`;
}

/** Split only one low-cardinality account dimension, never database/container inventory discovery. */
async function getAccountRequestDimension(
    client: MonitorClient,
    resourceUri: string,
    dimension: 'StatusCode' | 'OperationType',
    now: number,
): Promise<Record<string, number>> {
    const observation = DIAGNOSTIC_POLICY.accountRequests.observation;
    const seriesLimit = 1000;
    const response = await readMetrics(client, resourceUri, {
        metricnames: 'TotalRequests',
        aggregation: 'Count',
        timespan: advisoryTimespan(observation, now),
        interval: observation.interval,
        filter: dimension === 'StatusCode' ? "StatusCode eq '*'" : "StatusCode eq '429' and OperationType eq '*'",
        top: seriesLimit,
    });
    const counts = new Map<string, number>();
    for (const metric of response.value ?? []) {
        if (metric.errorCode && metric.errorCode !== 'Success') {
            throw new Error(metric.errorMessage ?? metric.errorCode);
        }
        if ((metric.timeseries?.length ?? 0) >= seriesLimit) {
            throw new Error('Account request metric series may be truncated.');
        }
        for (const series of metric.timeseries ?? []) {
            const key = series.metadatavalues
                ?.find((value) => value.name?.value?.toLowerCase() === dimension.toLowerCase())
                ?.value?.trim();
            if (!key) {
                continue;
            }
            for (const point of series.data ?? []) {
                const count = pickPointValue(point, 'Count');
                if (count === undefined || count <= 0 || parseMonitorTimestamp(point.timeStamp) === undefined) {
                    continue;
                }
                const total = (counts.get(key) ?? 0) + count;
                if (!Number.isFinite(total)) {
                    throw new Error('Account request metric count is not finite.');
                }
                counts.set(key, total);
            }
        }
    }
    return Object.fromEntries(counts);
}

export function getAccountRequestStatusCounts(client: MonitorClient, resourceUri: string, now = Date.now()) {
    return getAccountRequestDimension(client, resourceUri, 'StatusCode', now);
}

export function getThrottledOperationCounts(client: MonitorClient, resourceUri: string, now = Date.now()) {
    return getAccountRequestDimension(client, resourceUri, 'OperationType', now);
}

/** Account-total consumed-RU shape over the 30-day window (DX-014 serverless-candidate signal). */
export interface AccountConsumedRuShape {
    /** Account-total average consumed RU/s across the sampled buckets. */
    avgRuPerSec: number;
    /** Account-total peak consumed RU/s across the sampled buckets. */
    peakRuPerSec: number;
    /** Number of buckets sampled (0 ⇒ no telemetry in window). */
    sampleCount: number;
}

/**
 * Reads the account-total `TotalRequestUnits` (`Total`, no container filter) over the 30-day window and folds it
 * into an average/peak RU/s shape. Sums colliding series (e.g. per-region) per bucket so the result is the
 * account-total consumed RU per bucket, then divides by the bucket length to get RU/s. Feeds DX-014.
 */
export async function getAccountConsumedRuShape(
    client: MonitorClient,
    resourceUri: string,
): Promise<AccountConsumedRuShape> {
    const observation = DIAGNOSTIC_POLICY.serverless.observation;
    const response = await readMetrics(client, resourceUri, {
        metricnames: 'TotalRequestUnits',
        aggregation: 'Total',
        timespan: advisoryTimespan(observation),
        interval: observation.interval,
    });

    const perBucket = new Map<number, number>();
    for (const metric of response.value ?? []) {
        if (metric.errorCode && metric.errorCode !== 'Success') {
            throw new Error(metric.errorMessage ?? metric.errorCode);
        }
        for (const series of metric.timeseries ?? []) {
            for (const point of series.data ?? []) {
                const value = pickPointValue(point, 'Total');
                if (value === undefined) {
                    continue;
                }
                const ts = parseMonitorTimestamp(point.timeStamp);
                if (ts === undefined) {
                    continue;
                }
                perBucket.set(ts, (perBucket.get(ts) ?? 0) + value);
            }
        }
    }

    if (perBucket.size === 0) {
        return { avgRuPerSec: 0, peakRuPerSec: 0, sampleCount: 0 };
    }
    const bucketSeconds = observation.bucketMs / 1000;
    const ruPerSec = [...perBucket.values()].map((total) => total / bucketSeconds);
    const avgRuPerSec = ruPerSec.reduce((sum, v) => sum + v, 0) / ruPerSec.length;
    const peakRuPerSec = Math.max(...ruPerSec);
    return { avgRuPerSec, peakRuPerSec, sampleCount: ruPerSec.length };
}

/**
 * Reads known containers without wildcard dimensions, so Azure Monitor's series limit cannot omit other
 * containers. Shared member buckets are combined before taking the peak. An empty response remains unknown here.
 */
async function getContainerMetricPeak(
    client: MonitorClient,
    resourceUri: string,
    databaseId: string,
    containerId: string | undefined,
    metricName: string,
    aggregation: MetricAggregation,
    observation: RangeConfig,
    now: number,
    sharedContainerIds?: readonly string[],
): Promise<number | undefined> {
    const buckets = await querySeries(
        client,
        resourceUri,
        metricName,
        aggregation,
        advisoryTimespan(observation, now),
        observation.interval,
        requestMetricFilter(databaseId, containerId, sharedContainerIds),
        [databaseId, containerId ?? '', ...(sharedContainerIds ?? [])],
    );
    return buckets.size > 0 ? Math.max(...buckets.values()) : undefined;
}

/**
 * Reads an offer's peak `TotalRequestUnits` per bucket for the spike-aware idle gate (DX-004).
 * Shared membership must be explicit. Member and regional series are summed per bucket before taking the peak.
 * Successful reads without usable samples count as idle; request and embedded metric errors still reject.
 */
export async function getContainerIdlePeak(
    client: MonitorClient,
    resourceUri: string,
    databaseId: string,
    containerId: string | undefined,
    now = Date.now(),
    sharedContainerIds?: readonly string[],
): Promise<number> {
    if (containerId === undefined && sharedContainerIds === undefined) {
        throw new Error('Shared-offer idle metrics require authoritative container membership.');
    }
    const peak = await getContainerMetricPeak(
        client,
        resourceUri,
        databaseId,
        containerId,
        'TotalRequestUnits',
        'Total',
        DIAGNOSTIC_POLICY.idle.observation,
        now,
        sharedContainerIds,
    );
    return peak ?? 0;
}

/**
 * Reads a container's peak `PhysicalPartitionCount` for DX-009. Regional counts are folded with `max`.
 */
export async function getContainerPartitionCount(
    client: MonitorClient,
    resourceUri: string,
    databaseId: string,
    containerId: string,
    now = Date.now(),
): Promise<number | undefined> {
    const peak = await getContainerMetricPeak(
        client,
        resourceUri,
        databaseId,
        containerId,
        'PhysicalPartitionCount',
        'Maximum',
        DIAGNOSTIC_POLICY.partitionMerge.countObservation,
        now,
    );
    return peak === undefined ? undefined : Math.round(peak);
}

/**
 * Reads a container's peak `DataUsage` over the same recent window as {@link getContainerPartitionCount}.
 * Regional replicas are folded with `max`, not summed.
 */
export async function getContainerMergeStoragePeak(
    client: MonitorClient,
    resourceUri: string,
    databaseId: string,
    containerId: string,
    now = Date.now(),
): Promise<number | undefined> {
    return getContainerMetricPeak(
        client,
        resourceUri,
        databaseId,
        containerId,
        'DataUsage',
        'Maximum',
        DIAGNOSTIC_POLICY.partitionMerge.countObservation,
        now,
    );
}

/** Autoscale duty-cycle summary from the `AutoscaledRU`-as-%-of-configured-max series (DX-011 / DX-013). */
export interface AutoscaleUtilizationSummary {
    /** Peak of the series (0..100). */
    peakPercent: number;
    /** Average of the series (0..100). */
    avgPercent: number;
    /** Number of samples (0 ⇒ no telemetry in window). */
    sampleCount: number;
}

/**
 * Reads one autoscale offer's `AutoscaledRU` (`Maximum`) over the 30-day window, split by
 * `PhysicalPartitionId`, sums the per-partition provisioned value at each timestamp (the offer's provisioned
 * value is the sum across partitions), and normalises by the configured max to a 0..100 "how much of the max was
 * provisioned" series. Returns its peak/average duty cycle for DX-011 (peak band) and DX-013 (steady-high read).
 */
export async function getAutoscaleUtilization(
    client: MonitorClient,
    resourceUri: string,
    databaseId: string,
    containerId: string | undefined,
    configuredMaxRu: number,
): Promise<AutoscaleUtilizationSummary> {
    if (!Number.isFinite(configuredMaxRu) || configuredMaxRu <= 0) {
        throw new Error('Autoscale utilization requires a finite positive configured maximum.');
    }
    const filter = `${throughputOfferFilter(databaseId, containerId)} and PhysicalPartitionId eq '*'`;
    const observation = DIAGNOSTIC_POLICY.autoscaleUtilization.observation;
    const response = await readMetrics(
        client,
        resourceUri,
        {
            metricnames: 'AutoscaledRU',
            aggregation: 'Maximum',
            timespan: advisoryTimespan(observation),
            interval: observation.interval,
            filter,
        },
        [databaseId, containerId ?? ''],
    );

    // timestamp → summed AutoscaledRU across the container's physical partitions.
    const totals = new Map<number, number>();
    for (const metric of response.value ?? []) {
        if (metric.errorCode && metric.errorCode !== 'Success') {
            throw new Error(metric.errorMessage ?? metric.errorCode);
        }
        for (const series of metric.timeseries ?? []) {
            for (const point of series.data ?? []) {
                const value = pickPointValue(point, 'Maximum');
                if (value === undefined) {
                    continue;
                }
                const ts = parseMonitorTimestamp(point.timeStamp);
                if (ts === undefined) {
                    continue;
                }
                totals.set(ts, (totals.get(ts) ?? 0) + value);
            }
        }
    }

    if (totals.size === 0) {
        return { peakPercent: 0, avgPercent: 0, sampleCount: 0 };
    }
    const scale = 100 / configuredMaxRu;
    const percents = [...totals.values()].map((v) => v * scale);
    const avgPercent = percents.reduce((sum, v) => sum + v, 0) / percents.length;
    const peakPercent = Math.max(...percents);
    return { peakPercent, avgPercent, sampleCount: percents.length };
}

/** Independently latest populated index/data samples, without summing replicas or imputing missing sizes. */
export async function getContainerIndexingUsage(
    client: MonitorClient,
    resourceUri: string,
    databaseId: string,
    containerId: string,
    now = Date.now(),
): Promise<{ indexUsageBytes?: number; dataUsageBytes?: number }> {
    const observation = DIAGNOSTIC_POLICY.indexing.observation;
    const read = async (metricName: string): Promise<number | undefined> => {
        const buckets = await querySeries(
            client,
            resourceUri,
            metricName,
            'Maximum',
            advisoryTimespan(observation, now),
            observation.interval,
            containerFilter(databaseId, containerId),
            [databaseId, containerId],
        );
        return buckets.size > 0 ? buckets.get(Math.max(...buckets.keys())) : undefined;
    };
    const [indexUsageBytes, dataUsageBytes] = await Promise.all([read('IndexUsage'), read('DataUsage')]);
    return { indexUsageBytes, dataUsageBytes };
}
