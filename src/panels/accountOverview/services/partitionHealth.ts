/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { type MetricUnavailableReason } from '../metrics/contracts';
import { HEALTH_POLICY, OVERVIEW_DEFAULTS } from './healthPolicy';
import {
    metricFailureReason,
    classifyUnavailable,
    escapeODataLiteral,
    isHotPartition,
    parseMonitorTimestamp,
    pickPointValue,
    partitionSaturationStats,
    percentile,
    RANGE_CONFIG,
    type PartitionSaturationStats,
    type RangeConfig,
    type TimeRange,
    type UnavailableReason,
} from './shared';

// ─── Partition key distribution health ────────────────────────────────────────────
//
// Physical-partition RU / storage distribution for a single container, feeding
// both the heatmap grid and the ranked "why this is flagged" list. RU distribution is the
// per-physical-partition **p99 of `NormalizedRUConsumption`** (split by `PhysicalPartitionId`): a partition is
// saturated at p99 ≥ 90 %, and the container is a hot-partition case when the busiest partition is saturated while
// another still has headroom (p99 < 70 %) — the same CODA DX-006 signal the derived HotPartitionRisk advisory uses.
// Storage share comes from `PhysicalPartitionSizeInfo` split by `PhysicalPartitionId`, flagged on a balance ratio.
// Any Azure Monitor failure or missing dimension degrades to `available: false` so the webview renders the explicit
// "Partition telemetry unavailable for this API" empty-state rather than surfacing an error. Only physical
// partitions are exposed publicly; logical-partition heatmaps stay out of scope.

export type PartitionDistributionMode = 'ru' | 'storage';

/**
 * User-configurable partition-distribution thresholds, independent of Derived Advisory policy.
 * The three Health controls use `cosmosDB.accountOverview.health.*` keys;
 * `partition.topN` controls only the ranked-list length.
 */
export interface PartitionThresholds {
    /** RU: a physical partition's p99 (% of provisioned) at or above which it is saturated. */
    saturationPercent: number;
    /** RU: a physical partition's p99 below which it still has headroom — tells a hot partition apart from uniform saturation. */
    headroomPercent: number;
    /**
     * Storage: balance ratio (coolest physical partition ÷ this partition) below which a partition is flagged as
     * storage-skewed, provided it is also material (≥ 1 GiB). A perfectly even split is `1.0` and never fires.
     */
    skewBalanceRatio: number;
    /** How many partitions the ranked list surfaces. */
    topN: number;
}

export const DEFAULT_PARTITION_THRESHOLDS: PartitionThresholds = OVERVIEW_DEFAULTS.partition;

/** Intensity bucket for a heatmap tile; 5 is the hot/`--vscode-errorForeground` level. */
export type PartitionIntensityLevel = 1 | 2 | 3 | 4 | 5;

export interface PartitionTile {
    /** Raw `PartitionKeyRangeId` / `PhysicalPartitionId` value (rendered as `PKR-{id}`). */
    partitionId: string;
    /** RU mode: this partition's p99 saturation (% of provisioned). Storage mode: its share of storage. 0..100. */
    sharePercent: number;
    /** Intensity bucket 1..5 (5 = hot). */
    level: PartitionIntensityLevel;
    /** True when this partition is flagged: RU — saturated while the container has headroom elsewhere; storage — skewed. */
    hot: boolean;
}

export interface PartitionHealthResult {
    /** False when Azure Monitor exposes no per-partition series for this API/SKU. */
    available: boolean;
    /** Missing observations, unsupported API, or the actual request failure. */
    reason?: MetricUnavailableReason;
    mode: PartitionDistributionMode;
    databaseId: string;
    containerId: string;
    /** All partitions, sorted by descending share/saturation; the ranked list slices `topN`. */
    tiles: PartitionTile[];
    /**
     * Worst instantaneous skew over the window — `max` over timestamps of
     * `max(consumption)/sum(consumption)`, 0..100. For storage mode (no
     * per-timestamp series) this mirrors {@link topPartitionShare}.
     */
    skewScore: number;
    /** RU mode: the busiest partition's p99 saturation. Storage mode: the largest single-partition share. 0..100. */
    topPartitionShare: number;
    /** RU mode only: busiest partition's p99 (% of provisioned), for the DX-006 saturation signal. */
    maxSaturationPercent?: number;
    /** RU mode only: coolest partition's p99 (% of provisioned); a low value with a saturated busiest means skew. */
    minSaturationPercent?: number;
    /** RU mode only: true when this container is a hot-partition case (busiest saturated, another has headroom). */
    hotPartition?: boolean;
    partitionCount: number;
    /** How many partitions the ranked list should surface. */
    topN: number;
    /** Epoch milliseconds when the server produced this snapshot. */
    generatedAt: number;
}

/**
 * Buckets a partition's "excess" (how far past the hot boundary it sits, where `1` is exactly at the threshold)
 * into one of five intensity levels. A hot partition is always level 5 (`--vscode-errorForeground`); everything
 * below is spread linearly across levels 1–4 so an even distribution never lights up as hot. Pure.
 */
export function levelFromExcess(excess: number, hot: boolean): PartitionIntensityLevel {
    if (hot) {
        return 5;
    }
    if (!Number.isFinite(excess) || excess <= 0) {
        return 1;
    }
    const level = 1 + Math.floor(excess * 4);
    return Math.min(4, Math.max(1, level)) as PartitionIntensityLevel;
}

/**
 * Folds peak per-partition storage bytes over the chosen window into ranked heatmap tiles with shares, intensity
 * levels, and hot flags.
 * A partition is flagged when it is materially larger than the coolest sibling (balance ratio below the configured
 * floor), not on a raw share cutoff. User overrides affect these tiles, not Derived Advisories. Pure.
 */
export function deriveStorageTiles(
    weights: Map<string, number>,
    thresholds: PartitionThresholds,
): { tiles: PartitionTile[]; topPartitionShare: number } {
    const entries = [...weights.entries()];
    const values = entries.map(([, weight]) => Math.max(0, weight));
    const total = values.reduce((sum, v) => sum + v, 0);
    const count = entries.length;
    const coolest = count > 0 ? Math.min(...values) : 0;

    const tiles: PartitionTile[] = entries.map(([partitionId, weight]) => {
        const value = Math.max(0, weight);
        const sharePercent = total > 0 ? (value / total) * 100 : 0;
        const tileBalance = value > 0 ? coolest / value : 1;
        const material = value >= HEALTH_POLICY.partition.minBusiestBytes;
        const hot =
            count >= HEALTH_POLICY.partition.minPartitions &&
            material &&
            thresholds.skewBalanceRatio > 0 &&
            tileBalance < thresholds.skewBalanceRatio;
        const excess =
            thresholds.skewBalanceRatio > 0 && thresholds.skewBalanceRatio < 1
                ? (1 - tileBalance) / (1 - thresholds.skewBalanceRatio)
                : 0;
        return { partitionId, sharePercent, hot, level: levelFromExcess(excess, hot) };
    });
    tiles.sort((a, b) => b.sharePercent - a.sharePercent || a.partitionId.localeCompare(b.partitionId));
    const topPartitionShare = tiles.length > 0 ? tiles[0].sharePercent : 0;
    return { tiles, topPartitionShare };
}

/**
 * Folds per-physical-partition p99 utilizations into ranked heatmap tiles plus the container-level saturation
 * verdict. A partition is flagged hot only when the container as a whole is a hot-partition case (CODA DX-006 —
 * busiest partition saturated while another still has headroom) *and* this partition is the/one of the saturated
 * ones; uniform saturation (every partition busy) is global under-provisioning, not skew, and lights no red tiles.
 * The tile's displayed percent is the partition's own p99 saturation. Pure.
 */
export function deriveRuSaturationTiles(
    p99ByPartition: Map<string, number>,
    thresholds: PartitionThresholds,
): { tiles: PartitionTile[]; stats: PartitionSaturationStats; hotPartition: boolean } {
    const entries = [...p99ByPartition.entries()];
    const stats = partitionSaturationStats(entries.map(([, p99]) => p99));
    const hotPartition = isHotPartition(stats, thresholds.saturationPercent, thresholds.headroomPercent);

    const tiles: PartitionTile[] = entries.map(([partitionId, p99]) => {
        const sharePercent = Number.isFinite(p99) ? Math.max(0, p99) : 0;
        const saturated = thresholds.saturationPercent > 0 && sharePercent >= thresholds.saturationPercent;
        const hot = hotPartition && saturated;
        const excess = thresholds.saturationPercent > 0 ? sharePercent / thresholds.saturationPercent : 0;
        return { partitionId, sharePercent, hot, level: levelFromExcess(excess, hot) };
    });
    tiles.sort((a, b) => b.sharePercent - a.sharePercent || a.partitionId.localeCompare(b.partitionId));
    return { tiles, stats, hotPartition };
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

/** Computes the requested percentile per partition over a `partitionId → (ts → value)` matrix. */
function partitionPercentiles(matrix: Map<string, Map<number, number>>, percentileRank: number): Map<string, number> {
    const p99s = new Map<string, number>();
    for (const [partitionId, series] of matrix) {
        const p99 = percentile([...series.values()], percentileRank);
        if (p99 !== undefined) {
            p99s.set(partitionId, p99);
        }
    }
    return p99s;
}

/**
 * Fetches physical-partition RU or storage distribution for a single container
 * and folds it into heatmap tiles, a skew score, and hot-partition flags. Any
 * Monitor failure or empty dimension resolves to `available: false`.
 * Diagnostic callers supply `config`; chart callers keep the time-range preset.
 */
export async function getPartitionHealth(
    client: MonitorClient,
    resourceUri: string,
    mode: PartitionDistributionMode,
    timeRange: TimeRange,
    databaseId: string,
    containerId: string,
    thresholds: PartitionThresholds,
    config: RangeConfig = RANGE_CONFIG[timeRange],
    percentileRank: number = HEALTH_POLICY.partition.percentile,
): Promise<PartitionHealthResult> {
    const generatedAt = Date.now();
    const timespan = `${new Date(generatedAt - config.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;

    const empty: PartitionHealthResult = {
        available: false,
        mode,
        databaseId,
        containerId,
        tiles: [],
        skewScore: 0,
        topPartitionShare: 0,
        partitionCount: 0,
        topN: thresholds.topN,
        generatedAt,
    };

    if (mode === 'ru') {
        let matrix: Map<string, Map<number, number>>;
        try {
            matrix = await queryPartitionSplitSeries(
                client,
                resourceUri,
                'NormalizedRUConsumption',
                'PhysicalPartitionId',
                timespan,
                config.interval,
                databaseId,
                containerId,
            );
        } catch (error) {
            return { ...empty, reason: metricFailureReason(error) };
        }
        if (matrix.size === 0) {
            return { ...empty, reason: 'noData' };
        }
        const { tiles, stats, hotPartition } = deriveRuSaturationTiles(
            partitionPercentiles(matrix, percentileRank),
            thresholds,
        );
        return {
            available: true,
            mode,
            databaseId,
            containerId,
            tiles,
            skewScore: deriveSkewScore(matrix),
            topPartitionShare: stats.maxP99,
            maxSaturationPercent: stats.maxP99,
            minSaturationPercent: stats.minP99,
            hotPartition,
            partitionCount: tiles.length,
            topN: thresholds.topN,
            generatedAt,
        };
    }

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
        return { ...empty, reason: metricFailureReason(error) };
    }
    if (matrix.size === 0) {
        return { ...empty, reason: 'noData' };
    }
    // Rank storage by each partition's peak reported size over the chosen window so the heatmap matches the detector.
    const weights = new Map<string, number>();
    for (const [partitionId, series] of matrix) {
        if (series.size > 0) {
            weights.set(partitionId, Math.max(...series.values()));
        }
    }
    if (weights.size === 0) {
        return { ...empty, reason: 'noData' };
    }

    const { tiles, topPartitionShare } = deriveStorageTiles(weights, thresholds);
    return {
        available: true,
        mode,
        databaseId,
        containerId,
        tiles,
        skewScore: topPartitionShare,
        topPartitionShare,
        partitionCount: tiles.length,
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
 * Diagnostic callers supply `config`; chart callers keep the time-range preset.
 */
export async function getPartitionStorageSeries(
    client: MonitorClient,
    resourceUri: string,
    timeRange: TimeRange,
    databaseId: string,
    containerId: string,
    config: RangeConfig = RANGE_CONFIG[timeRange],
): Promise<PartitionStorageResult> {
    const generatedAt = Date.now();
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
    const filter = `DatabaseName eq '${escapeODataLiteral(databaseId)}' and CollectionName eq '${escapeODataLiteral(containerId)}' and ${dimension} eq '*'`;
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
            byPartition.set(partitionId, buckets);
        }
    }
    return byPartition;
}
