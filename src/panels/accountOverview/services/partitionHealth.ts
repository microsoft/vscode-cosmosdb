/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { classifyUnavailable, lastValue, RANGE_CONFIG, type TimeRange, type UnavailableReason } from './shared';

// ─── Partition key distribution health ────────────────────────────────────────────
//
// Physical-partition RU / storage distribution for a single container, feeding
// both the heatmap grid and the ranked "why this is flagged" list. RU share is
// derived from `NormalizedRUConsumption` split by `PartitionKeyRangeId`; storage
// share from `PhysicalPartitionSizeInfo` split by `PhysicalPartitionId`. The portal's skew score
// is computed client-side per timestamp: `max(consumption_at_T) / sum(consumption_at_T)`. Any
// Azure Monitor failure or missing dimension degrades to `available: false` so the webview renders
// the explicit "Partition telemetry unavailable for this API" empty-state rather than surfacing an
// error. Only physical partitions are exposed publicly; logical-partition heatmaps stay out of scope.

export type PartitionDistributionMode = 'ru' | 'storage';

/** Partition-skew thresholds, sourced from `cosmosDB.accountOverview.partition.*`. */
export interface PartitionThresholds {
    /** Top physical-partition RU share (%) above which a partition is a hot-partition risk. */
    hotRuSharePercent: number;
    /** Top physical-partition storage share (%) above which storage is skewed. */
    skewedStorageSharePercent: number;
    /** How many partitions the ranked list surfaces. */
    topN: number;
}

export const DEFAULT_PARTITION_THRESHOLDS: PartitionThresholds = {
    hotRuSharePercent: 40,
    skewedStorageSharePercent: 35,
    topN: 5,
};

/** Intensity bucket for a heatmap tile; 5 is the hot/`--vscode-errorForeground` level. */
export type PartitionIntensityLevel = 1 | 2 | 3 | 4 | 5;

export interface PartitionTile {
    /** Raw `PartitionKeyRangeId` / `PhysicalPartitionId` value (rendered as `PKR-{id}`). */
    partitionId: string;
    /** Share of RU (or storage) for this partition over the window, 0..100. */
    sharePercent: number;
    /** Intensity bucket 1..5 (5 = hot). */
    level: PartitionIntensityLevel;
    /** True when this partition's share crosses the configured hot threshold. */
    hot: boolean;
}

export interface PartitionHealthResult {
    /** False when Azure Monitor exposes no per-partition series for this API/SKU. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    mode: PartitionDistributionMode;
    databaseId: string;
    containerId: string;
    /** All partitions, sorted by descending share; the ranked list slices `topN`. */
    tiles: PartitionTile[];
    /**
     * Worst instantaneous skew over the window — `max` over timestamps of
     * `max(consumption)/sum(consumption)`, 0..100. For storage mode (no
     * per-timestamp series) this mirrors {@link topPartitionShare}.
     */
    skewScore: number;
    /** Largest single-partition share over the window, 0..100. */
    topPartitionShare: number;
    partitionCount: number;
    /** Share (%) at/above which a partition is flagged hot for the active mode. */
    hotThresholdPercent: number;
    /** How many partitions the ranked list should surface. */
    topN: number;
    /** Epoch milliseconds when the server produced this snapshot. */
    generatedAt: number;
}

/**
 * Buckets a partition's share into one of five intensity levels. A share at or
 * above the hot threshold is level 5 (hot); everything below is spread linearly
 * across levels 1–4 so an even distribution never lights up as hot. Pure.
 */
export function intensityLevel(sharePercent: number, hotThresholdPercent: number): PartitionIntensityLevel {
    if (hotThresholdPercent > 0 && sharePercent >= hotThresholdPercent) {
        return 5;
    }
    if (hotThresholdPercent <= 0) {
        return sharePercent > 0 ? 5 : 1;
    }
    const ratio = sharePercent / hotThresholdPercent; // 0..1 below the hot line
    const level = 1 + Math.floor(ratio * 4);
    return Math.min(4, Math.max(1, level)) as PartitionIntensityLevel;
}

/**
 * Folds per-partition weights (summed RU consumption or latest storage bytes)
 * into ranked heatmap tiles with shares, intensity levels, and hot flags. Pure
 * so it can be unit-tested against synthetic weights.
 */
export function derivePartitionTiles(
    weights: Map<string, number>,
    hotThresholdPercent: number,
): { tiles: PartitionTile[]; topPartitionShare: number } {
    const total = [...weights.values()].reduce((sum, v) => sum + Math.max(0, v), 0);
    const tiles: PartitionTile[] = [...weights.entries()].map(([partitionId, weight]) => {
        const sharePercent = total > 0 ? (Math.max(0, weight) / total) * 100 : 0;
        const hot = hotThresholdPercent > 0 && sharePercent >= hotThresholdPercent;
        return { partitionId, sharePercent, hot, level: intensityLevel(sharePercent, hotThresholdPercent) };
    });
    tiles.sort((a, b) => b.sharePercent - a.sharePercent || a.partitionId.localeCompare(b.partitionId));
    const topPartitionShare = tiles.length > 0 ? tiles[0].sharePercent : 0;
    return { tiles, topPartitionShare };
}

/**
 * Computes the portal's per-timestamp skew score from a `partitionId → (ts →
 * value)` matrix: for each timestamp, `max(value)/sum(value)`; the reported
 * score is the worst (max) such ratio over the window, as a percentage. Pure.
 */
export function deriveSkewScore(matrix: Map<string, Map<number, number>>): number {
    const perTimestamp = new Map<number, { max: number; sum: number }>();
    for (const series of matrix.values()) {
        for (const [ts, value] of series) {
            if (value <= 0) {
                continue;
            }
            const entry = perTimestamp.get(ts) ?? { max: 0, sum: 0 };
            entry.sum += value;
            entry.max = Math.max(entry.max, value);
            perTimestamp.set(ts, entry);
        }
    }
    let worst = 0;
    for (const { max, sum } of perTimestamp.values()) {
        if (sum > 0) {
            worst = Math.max(worst, max / sum);
        }
    }
    return worst * 100;
}

/** Sums each partition's values across the window into a single weight per partition. */
function sumMatrix(matrix: Map<string, Map<number, number>>): Map<string, number> {
    const weights = new Map<string, number>();
    for (const [partitionId, series] of matrix) {
        let total = 0;
        for (const value of series.values()) {
            total += value;
        }
        weights.set(partitionId, total);
    }
    return weights;
}

/**
 * Fetches physical-partition RU or storage distribution for a single container
 * and folds it into heatmap tiles, a skew score, and hot-partition flags. Any
 * Monitor failure or empty dimension resolves to `available: false`.
 */
export async function getPartitionHealth(
    client: MonitorClient,
    resourceUri: string,
    mode: PartitionDistributionMode,
    timeRange: TimeRange,
    databaseId: string,
    containerId: string,
    thresholds: PartitionThresholds,
): Promise<PartitionHealthResult> {
    const generatedAt = Date.now();
    const config = RANGE_CONFIG[timeRange];
    const timespan = `${new Date(generatedAt - config.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;
    const hotThresholdPercent = mode === 'ru' ? thresholds.hotRuSharePercent : thresholds.skewedStorageSharePercent;

    const empty: PartitionHealthResult = {
        available: false,
        mode,
        databaseId,
        containerId,
        tiles: [],
        skewScore: 0,
        topPartitionShare: 0,
        partitionCount: 0,
        hotThresholdPercent,
        topN: thresholds.topN,
        generatedAt,
    };

    let weights: Map<string, number>;
    let skewScore: number;

    if (mode === 'ru') {
        let matrix: Map<string, Map<number, number>>;
        try {
            matrix = await queryPartitionSplitSeries(
                client,
                resourceUri,
                'NormalizedRUConsumption',
                'PartitionKeyRangeId',
                timespan,
                config.interval,
                databaseId,
                containerId,
            );
        } catch (error) {
            return { ...empty, reason: classifyUnavailable(error) };
        }
        if (matrix.size === 0) {
            return { ...empty, reason: 'noData' };
        }
        weights = sumMatrix(matrix);
        skewScore = deriveSkewScore(matrix);
    } else {
        let matrix: Map<string, Map<number, number>>;
        try {
            matrix = await queryPartitionSplitSeries(
                client,
                resourceUri,
                'PhysicalPartitionSizeInfo',
                'PhysicalPartitionId',
                timespan,
                config.interval,
                databaseId,
                containerId,
            );
        } catch (error) {
            return { ...empty, reason: classifyUnavailable(error) };
        }
        if (matrix.size === 0) {
            return { ...empty, reason: 'noData' };
        }
        // Storage is effectively static across the window; rank by the latest reported size.
        weights = new Map<string, number>();
        for (const [partitionId, series] of matrix) {
            const latest = lastValue(series);
            if (latest !== undefined) {
                weights.set(partitionId, latest);
            }
        }
        if (weights.size === 0) {
            return { ...empty, reason: 'noData' };
        }
        skewScore = 0; // set to top share below, once known
    }

    const { tiles, topPartitionShare } = derivePartitionTiles(weights, hotThresholdPercent);
    if (mode === 'storage') {
        skewScore = topPartitionShare;
    }

    return {
        available: true,
        mode,
        databaseId,
        containerId,
        tiles,
        skewScore,
        topPartitionShare,
        partitionCount: tiles.length,
        hotThresholdPercent,
        topN: thresholds.topN,
        generatedAt,
    };
}

/** One `PhysicalPartitionSizeInfo` datapoint for a single physical partition. */
export interface PartitionStorageSample {
    /** Epoch milliseconds of the datapoint. */
    timestamp: number;
    /** Reported physical-partition size in bytes. */
    bytes: number;
}

/** A physical partition's storage size series over the window (oldest → newest). */
export interface PartitionStorageSeries {
    /** Raw `PhysicalPartitionId` value. */
    partitionId: string;
    samples: PartitionStorageSample[];
}

export interface PartitionStorageResult {
    /** False when Azure Monitor exposes no `PhysicalPartitionSizeInfo` series for this API/SKU. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    databaseId: string;
    containerId: string;
    /** Per-physical-partition storage series over the window. */
    partitions: PartitionStorageSeries[];
    /** Epoch milliseconds when the server produced this snapshot. */
    generatedAt: number;
}

/**
 * Fetches the per-physical-partition `PhysicalPartitionSizeInfo` time series for a
 * single container, in raw bytes. Unlike {@link getPartitionHealth}, this keeps
 * the full series (not just the latest size) and the absolute byte values, so the
 * derived-advisory engine can fit a growth trajectory per partition and gauge each
 * partition's proximity to the 50 GiB split ceiling. Any Monitor failure or empty
 * dimension resolves to `available: false`.
 */
export async function getPartitionStorageSeries(
    client: MonitorClient,
    resourceUri: string,
    timeRange: TimeRange,
    databaseId: string,
    containerId: string,
): Promise<PartitionStorageResult> {
    const generatedAt = Date.now();
    const config = RANGE_CONFIG[timeRange];
    const timespan = `${new Date(generatedAt - config.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;

    const empty: PartitionStorageResult = {
        available: false,
        databaseId,
        containerId,
        partitions: [],
        generatedAt,
    };

    let matrix: Map<string, Map<number, number>>;
    try {
        matrix = await queryPartitionSplitSeries(
            client,
            resourceUri,
            'PhysicalPartitionSizeInfo',
            'PhysicalPartitionId',
            timespan,
            config.interval,
            databaseId,
            containerId,
        );
    } catch (error) {
        return { ...empty, reason: classifyUnavailable(error) };
    }
    if (matrix.size === 0) {
        return { ...empty, reason: 'noData' };
    }

    const partitions: PartitionStorageSeries[] = [...matrix.entries()].map(([partitionId, series]) => ({
        partitionId,
        samples: [...series.entries()]
            .map(([timestamp, bytes]) => ({ timestamp, bytes }))
            .sort((a, b) => a.timestamp - b.timestamp),
    }));

    return { available: true, databaseId, containerId, partitions, generatedAt };
}

/**
 * Reads a metric's max aggregation for one container, split by a partition
 * dimension (`PartitionKeyRangeId` or `PhysicalPartitionId`), into a
 * `partitionId → (timestamp → value)` matrix.
 */
async function queryPartitionSplitSeries(
    client: MonitorClient,
    resourceUri: string,
    metricName: string,
    dimension: string,
    timespan: string,
    interval: string,
    databaseId: string,
    containerId: string,
): Promise<Map<string, Map<number, number>>> {
    const filter = `DatabaseName eq '${databaseId}' and CollectionName eq '${containerId}' and ${dimension} eq '*'`;
    const response = await client.metrics.list(resourceUri, {
        metricnames: metricName,
        aggregation: 'Maximum',
        timespan,
        interval,
        filter,
    });

    const dimensionKey = dimension.toLowerCase();
    const byPartition = new Map<string, Map<number, number>>();
    for (const metric of response.value ?? []) {
        for (const series of metric.timeseries ?? []) {
            const partitionId = series.metadatavalues?.find(
                (m) => m.name?.value?.toLowerCase() === dimensionKey,
            )?.value;
            if (partitionId === undefined || partitionId === '') {
                continue;
            }
            const buckets = byPartition.get(partitionId) ?? new Map<number, number>();
            for (const point of series.data ?? []) {
                if (point.maximum === undefined) {
                    continue;
                }
                const ts = new Date(point.timeStamp).getTime();
                buckets.set(ts, Math.max(buckets.get(ts) ?? 0, point.maximum));
            }
            byPartition.set(partitionId, buckets);
        }
    }
    return byPartition;
}
