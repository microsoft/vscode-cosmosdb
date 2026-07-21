/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { DAY, HOUR, seriesContainerKey } from './shared';

// ─── Batch-2 derived-advisory metric fetchers ─────────────────────────────────────
//
// The metrics-based Tier-1 detectors (DX-004 idle, DX-009 partition-merge, DX-011 autoscale-max, DX-013
// autoscale→manual, DX-014 serverless) each need an Azure Monitor query path the rest of the dashboard does not
// already fetch. They share a long 30-day look-back — long enough that a periodic (e.g. monthly-batch) workload
// shows its spike and is not mistaken for idle — bucketed hourly to bound the number of datapoints per query.
// All series are read as `Total`/`Maximum` and folded to per-container (or account-total) shapes the pure
// evaluators in `derivedAdvisories.ts` consume. Callers catch failures and degrade to an empty state.

/** DX-004 / DX-014 look back this many days — long enough to avoid flagging periodic (monthly-batch) workloads. */
const ADVISORY_WINDOW_DAYS = 30;
/** Hourly buckets over the 30-day window bound the datapoint count while still isolating idle from active load. */
const ADVISORY_INTERVAL = 'PT1H';
/** Seconds per hourly bucket, to convert consumed RU (`Total`) into an average/peak RU/s. */
const BUCKET_SECONDS = HOUR / 1000;
/** Physical-partition count is slow-moving state; a short recent window at the metric's 5-minute grain suffices. */
const PARTITION_COUNT_WINDOW_HOURS = 6;
const PARTITION_COUNT_INTERVAL = 'PT5M';

/** Builds the `start/end` ISO-8601 timespan for the 30-day advisory window ending now. */
function advisoryTimespan(now = Date.now()): string {
    const start = now - ADVISORY_WINDOW_DAYS * DAY;
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
    const response = await client.metrics.list(resourceUri, {
        metricnames: 'TotalRequestUnits',
        aggregation: 'Total',
        timespan: advisoryTimespan(),
        interval: ADVISORY_INTERVAL,
    });

    const perBucket = new Map<number, number>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            for (const point of series.data ?? []) {
                if (point.total === undefined) {
                    continue;
                }
                const ts = new Date(point.timeStamp).getTime();
                perBucket.set(ts, (perBucket.get(ts) ?? 0) + point.total);
            }
        }
    }

    if (perBucket.size === 0) {
        return { avgRuPerSec: 0, peakRuPerSec: 0, sampleCount: 0 };
    }
    const ruPerSec = [...perBucket.values()].map((total) => total / BUCKET_SECONDS);
    const avgRuPerSec = ruPerSec.reduce((sum, v) => sum + v, 0) / ruPerSec.length;
    const peakRuPerSec = Math.max(...ruPerSec);
    return { avgRuPerSec, peakRuPerSec, sampleCount: ruPerSec.length };
}

/**
 * Reads per-container `TotalRequestUnits` (`Total`) over the 30-day window, split by
 * `DatabaseName`/`CollectionName`, and returns each container's **peak RU consumed in any single bucket** — the
 * spike-aware idle gate for DX-004. Colliding series (per-region) are summed per bucket before taking the peak,
 * so the value is the container-total per-bucket peak. A container absent from the response (Azure pads idle
 * windows with zeros) simply never appears; the caller defaults it to a peak of 0, which is the idle signal.
 */
export async function getContainerIdlePeaks(client: MonitorClient, resourceUri: string): Promise<Map<string, number>> {
    const response = await client.metrics.list(resourceUri, {
        metricnames: 'TotalRequestUnits',
        aggregation: 'Total',
        timespan: advisoryTimespan(),
        interval: ADVISORY_INTERVAL,
        filter: `DatabaseName eq '*' and CollectionName eq '*'`,
    });

    // containerKey → (timestamp → summed RU) so per-region series fold into a container-total per bucket.
    const perContainer = new Map<string, Map<number, number>>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            const key = seriesContainerKey(series.metadatavalues);
            if (!key) {
                continue;
            }
            const buckets = perContainer.get(key) ?? new Map<number, number>();
            for (const point of series.data ?? []) {
                if (point.total === undefined) {
                    continue;
                }
                const ts = new Date(point.timeStamp).getTime();
                buckets.set(ts, (buckets.get(ts) ?? 0) + point.total);
            }
            perContainer.set(key, buckets);
        }
    }

    const peaks = new Map<string, number>();
    for (const [key, buckets] of perContainer) {
        const peak = buckets.size > 0 ? Math.max(...buckets.values()) : 0;
        peaks.set(key, peak);
    }
    return peaks;
}

/**
 * Reads per-container `PhysicalPartitionCount` (`Maximum`) over a short recent window, split by
 * `DatabaseName`/`CollectionName`, and returns each container's actual physical-partition count for DX-009.
 * Colliding series are folded with `max` (the count is identical across regions).
 */
export async function getContainerPartitionCounts(
    client: MonitorClient,
    resourceUri: string,
    now = Date.now(),
): Promise<Map<string, number>> {
    const timespan = `${new Date(now - PARTITION_COUNT_WINDOW_HOURS * HOUR).toISOString()}/${new Date(now).toISOString()}`;
    const response = await client.metrics.list(resourceUri, {
        metricnames: 'PhysicalPartitionCount',
        aggregation: 'Maximum',
        timespan,
        interval: PARTITION_COUNT_INTERVAL,
        filter: `DatabaseName eq '*' and CollectionName eq '*'`,
    });

    const counts = new Map<string, number>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            const key = seriesContainerKey(series.metadatavalues);
            if (!key) {
                continue;
            }
            let peak = counts.get(key) ?? 0;
            for (const point of series.data ?? []) {
                if (point.maximum === undefined) {
                    continue;
                }
                peak = Math.max(peak, point.maximum);
            }
            counts.set(key, peak);
        }
    }

    for (const [key, value] of counts) {
        counts.set(key, Math.round(value));
    }
    return counts;
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
    const filter = `DatabaseName eq '${databaseId}' and CollectionName eq '${containerId}' and PhysicalPartitionId eq '*'`;
    const response = await client.metrics.list(resourceUri, {
        metricnames: 'AutoscaledRU',
        aggregation: 'Maximum',
        timespan: advisoryTimespan(),
        interval: ADVISORY_INTERVAL,
        filter,
    });

    // timestamp → summed AutoscaledRU across the container's physical partitions.
    const totals = new Map<number, number>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            for (const point of series.data ?? []) {
                if (point.maximum === undefined) {
                    continue;
                }
                const ts = new Date(point.timeStamp).getTime();
                totals.set(ts, (totals.get(ts) ?? 0) + point.maximum);
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
