/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { querySeries } from '../../ruTrends';
import {
    containerFilter,
    escapeODataLiteral,
    parseMonitorTimestamp,
    pickPointValue,
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
// evaluators consume. Callers report failed or missing evidence as incomplete coverage, never assumed zero usage.

/** Builds the `start/end` ISO-8601 timespan for a diagnostic observation ending now. */
function advisoryTimespan(observation: RangeConfig, now = Date.now()): string {
    const start = now - observation.windowMs;
    return `${new Date(start).toISOString()}/${new Date(now).toISOString()}`;
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
    const response = await client.metrics.list(resourceUri, {
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
 * Reads one known container without wildcard dimensions, so Azure Monitor's series limit cannot omit other
 * containers. Only observed numeric samples count as evidence; an empty response remains unknown, not zero.
 */
async function getContainerMetricPeak(
    client: MonitorClient,
    resourceUri: string,
    databaseId: string,
    containerId: string,
    metricName: string,
    aggregation: MetricAggregation,
    observation: RangeConfig,
    now: number,
): Promise<number | undefined> {
    const buckets = await querySeries(
        client,
        resourceUri,
        metricName,
        aggregation,
        advisoryTimespan(observation, now),
        observation.interval,
        containerFilter(databaseId, containerId),
    );
    return buckets.size > 0 ? Math.max(...buckets.values()) : undefined;
}

/**
 * Reads a container's peak `TotalRequestUnits` per bucket for the spike-aware idle gate (DX-004).
 * Regional series are summed per bucket before taking the peak.
 */
export async function getContainerIdlePeak(
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
        'TotalRequestUnits',
        'Total',
        DIAGNOSTIC_POLICY.idle.observation,
        now,
    );
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
 * Reads one autoscale container's `AutoscaledRU` (`Maximum`) over the 30-day window, split by
 * `PhysicalPartitionId`, sums the per-partition provisioned value at each timestamp (the container's provisioned
 * value is the sum across partitions), and normalises by the configured max to a 0..100 "how much of the max was
 * provisioned" series. Returns its peak/average duty cycle for DX-011 (peak band) and DX-013 (steady-high read).
 */
export async function getAutoscaleUtilization(
    client: MonitorClient,
    resourceUri: string,
    databaseId: string,
    containerId: string,
    configuredMaxRu: number,
): Promise<AutoscaleUtilizationSummary> {
    if (!(configuredMaxRu > 0)) {
        return { peakPercent: 0, avgPercent: 0, sampleCount: 0 };
    }
    const filter = `DatabaseName eq '${escapeODataLiteral(databaseId)}' and CollectionName eq '${escapeODataLiteral(containerId)}' and PhysicalPartitionId eq '*'`;
    const observation = DIAGNOSTIC_POLICY.autoscaleUtilization.observation;
    const response = await client.metrics.list(resourceUri, {
        metricnames: 'AutoscaledRU',
        aggregation: 'Maximum',
        timespan: advisoryTimespan(observation),
        interval: observation.interval,
        filter,
    });

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
