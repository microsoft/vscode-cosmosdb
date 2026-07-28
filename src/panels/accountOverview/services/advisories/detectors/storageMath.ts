/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionStorageSample } from '../../partitionHealth';
import { mean } from '../core/helpers';
import { type StoragePartitionSeries } from '../core/types';

export const GIB = 1024 ** 3;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Physical-partition storage split ceiling (50 GiB) — the wall StorageGrowthRisk projects to. Azure platform
// limit, not a heuristic:
// https://learn.microsoft.com/azure/cosmos-db/partitioning#physical-partitions
export const PARTITION_STORAGE_LIMIT_BYTES = 50 * GIB;
/** Below this current size a partition is immaterial and ignored (a tiny partition near the wall is not a concern). */
export const STORAGE_GROWTH_MIN_MATERIAL_BYTES = 1 * GIB;
/** Below this slope the growth is noise, not a trend — avoids projecting a wall from flat/jittery series. */
export const STORAGE_GROWTH_MIN_SLOPE_BYTES_PER_DAY = 0.1 * GIB;
/** Days-to-limit at or below which StorageGrowthRisk ranks High. */
export const STORAGE_GROWTH_HIGH_DAYS = 30;
/** Days-to-limit at or below which StorageGrowthRisk ranks Medium (above it, up to the horizon, Low). */
export const STORAGE_GROWTH_MEDIUM_DAYS = 90;

/** Below this busiest-partition size, storage skew is immaterial (a balanced-but-tiny split is not a concern). */
export const STORAGE_SKEW_MIN_BUSIEST_BYTES = 1 * GIB;
/** Busiest-partition size (≥ 80% of the 50 GiB ceiling) at or above which StorageSkewRisk ranks High. */
export const STORAGE_SKEW_HIGH_BYTES = 40 * GIB;
/** Busiest-partition size (≥ 50% of the 50 GiB ceiling) at or above which StorageSkewRisk ranks Medium. */
export const STORAGE_SKEW_MEDIUM_BYTES = 25 * GIB;

/** Latest (newest-timestamp) size in bytes of a partition's series, or undefined when it has no samples. Pure. */
export function latestBytes(series: StoragePartitionSeries): number | undefined {
    let latest: { timestamp: number; bytes: number } | undefined;
    for (const sample of series.samples) {
        if (!Number.isFinite(sample.bytes) || !Number.isFinite(sample.timestamp)) {
            continue;
        }
        if (latest === undefined || sample.timestamp >= latest.timestamp) {
            latest = sample;
        }
    }
    return latest?.bytes;
}

/**
 * Least-squares slope of a partition's storage series in bytes/day. Returns
 * `undefined` when there are fewer than two datapoints at distinct times (no
 * trend can be fit). Fitting a trajectory — rather than a raw last-minus-first
 * delta — is robust to a single noisy endpoint. Pure.
 */
export function storageGrowthSlopeBytesPerDay(samples: readonly PartitionStorageSample[]): number | undefined {
    const clean = samples.filter((s) => Number.isFinite(s.timestamp) && Number.isFinite(s.bytes));
    if (clean.length < 2) {
        return undefined;
    }
    const xsDays = clean.map((s) => s.timestamp / MS_PER_DAY);
    const ys = clean.map((s) => s.bytes);
    const meanX = mean(xsDays);
    const meanY = mean(ys);
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < clean.length; i++) {
        const dx = xsDays[i] - meanX;
        numerator += dx * (ys[i] - meanY);
        denominator += dx * dx;
    }
    if (denominator === 0) {
        return undefined;
    }
    return numerator / denominator;
}

/**
 * Projected days for a partition at `currentBytes` growing at `slopeBytesPerDay`
 * to reach `limitBytes`. Returns 0 if it is already at/over the limit, and
 * `undefined` for a flat or shrinking trajectory (it never reaches the wall).
 * Pure.
 */
export function daysToStorageLimit(
    currentBytes: number,
    slopeBytesPerDay: number,
    limitBytes: number,
): number | undefined {
    if (!Number.isFinite(slopeBytesPerDay) || slopeBytesPerDay <= 0) {
        return undefined;
    }
    if (currentBytes >= limitBytes) {
        return 0;
    }
    return (limitBytes - currentBytes) / slopeBytesPerDay;
}

/**
 * Balance ratio (`min ÷ max`) of a set of physical-partition sizes: 1.0 is
 * perfectly balanced, values near 0 mean one partition dwarfs its siblings.
 * Returns `undefined` for fewer than two sizes or a non-positive max (nothing to
 * compare). Pure.
 */
export function balanceRatio(sizesBytes: readonly number[]): number | undefined {
    const clean = sizesBytes.filter((v) => Number.isFinite(v) && v >= 0);
    if (clean.length < 2) {
        return undefined;
    }
    const max = Math.max(...clean);
    const min = Math.min(...clean);
    if (max <= 0) {
        return undefined;
    }
    return min / max;
}
