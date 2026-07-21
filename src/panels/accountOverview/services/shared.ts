/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ─── Account Overview shared service primitives ─────────────────────────────────
//
// Cross-zone vocabulary and Azure Monitor helpers shared by every dashboard-zone
// service (RU trends, inventory metrics, partition health, …). Pure: no vscode or
// tRPC imports, so the whole module graph below stays unit-testable.

export type TimeRange = '1H' | '24H' | '7D';

/**
 * Why an async dashboard section has no data to render. The webview
 * maps each value to a distinct empty-state copy so users can tell an
 * as-yet-empty telemetry pipeline (`noData`) apart from an API/SKU that never
 * emits the metric (`unsupported`), a missing Azure RBAC role (`rbac`), and a
 * Log Analytics data path whose diagnostic settings were never enabled so the
 * `CDB*` tables do not exist for the resource (`logAnalyticsDisabled`). The last
 * is Tier-2-specific: it drives the derived-advisories partial-coverage notice
 * rather than a whole-section empty-state.
 */
export type UnavailableReason = 'noData' | 'unsupported' | 'rbac' | 'logAnalyticsDisabled';

/**
 * Classifies an Azure SDK error into an {@link UnavailableReason}. A 403 (or the
 * ARM `AuthorizationFailed`/`Forbidden` code) means the signed-in identity is
 * missing a role; everything else degrades to `noData` (transient, empty, or an
 * unsupported dimension the caller could not distinguish up front). Pure.
 */
export function classifyUnavailable(error: unknown): UnavailableReason {
    if (error && typeof error === 'object') {
        const e = error as { statusCode?: number; code?: string | number };
        if (e.statusCode === 403 || e.code === 403 || e.code === 'AuthorizationFailed' || e.code === 'Forbidden') {
            return 'rbac';
        }
    }
    return 'noData';
}

/** Shared vocabulary for both per-row and account-level health. */
export type HealthState = 'Healthy' | 'Needs Attention' | 'Critical';

/** Provisioning states ARM reports for a Cosmos DB account. */
export type ProvisioningState = 'Succeeded' | 'Creating' | 'Updating' | 'Deleting' | 'Failed' | 'Canceled';

/**
 * ISO-8601 metric time-grains, coarsest-supporting order. Not every Cosmos metric
 * is emitted at the fine grains a short {@link TimeRange} would otherwise request
 * (e.g. storage/throughput start at `PT5M`, `ServiceAvailability` only at `PT1H`),
 * so a provider can declare the finest grain it supports and callers floor to it.
 */
export type MetricGranularity = 'PT1M' | 'PT5M' | 'PT15M' | 'PT30M' | 'PT1H' | 'P1D';

const GRANULARITY_MINUTES: Record<MetricGranularity, number> = {
    PT1M: 1,
    PT5M: 5,
    PT15M: 15,
    PT30M: 30,
    PT1H: 60,
    P1D: 1440,
};

export interface RangeConfig {
    /** Window length in milliseconds. */
    windowMs: number;
    /** ISO-8601 duration for the metric interval (bucket size). */
    interval: MetricGranularity;
    /** Bucket size in milliseconds, used for the sustained-throttling run length. */
    bucketMs: number;
}

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const RANGE_CONFIG: Record<TimeRange, RangeConfig> = {
    '1H': { windowMs: HOUR, interval: 'PT1M', bucketMs: MINUTE },
    '24H': { windowMs: DAY, interval: 'PT5M', bucketMs: 5 * MINUTE },
    '7D': { windowMs: 7 * DAY, interval: 'PT1H', bucketMs: HOUR },
};

/** Bucket size (ms) for a metric time-range, exposed for the derived-advisory throttling run length. */
export function bucketMsForRange(range: TimeRange): number {
    return RANGE_CONFIG[range].bucketMs;
}

/**
 * Floors a range's default `interval` to a metric's coarsest supported grain: if
 * the range asks for a finer grain than the metric emits, the request is bumped up
 * to `floor` so Azure Monitor returns data instead of an empty/failed series. A
 * `floor` of `undefined` (metric supports the finest grains) leaves `interval`
 * unchanged. Pure.
 */
export function effectiveInterval(
    interval: MetricGranularity,
    floor: MetricGranularity | undefined,
): MetricGranularity {
    if (!floor) {
        return interval;
    }
    return GRANULARITY_MINUTES[interval] >= GRANULARITY_MINUTES[floor] ? interval : floor;
}

/** 429 share above which a bucket counts as throttled. */
export const THROTTLING_SHARE_THRESHOLD = 0.01;
/** A throttling run must span at least this long to be reported as sustained. */
export const MIN_THROTTLING_DURATION_MS = 5 * MINUTE;

export function isThrottledStatusCode(code: string | undefined): boolean {
    return code === '429' || code?.startsWith('429') === true;
}

/** The subset of an Azure Monitor datapoint {@link pickPointValue} reads from. */
export interface MonitorPoint {
    maximum?: number;
    average?: number;
    total?: number;
}

/**
 * Azure Monitor aggregation to read for a metric. Each maps to a distinct field on
 * a datapoint (`Maximum → maximum`, `Average → average`, `Total → total`).
 */
export type MetricAggregation = 'Maximum' | 'Average' | 'Total';

/**
 * Reads the field of an Azure Monitor datapoint that matches the requested
 * aggregation (`Maximum → maximum`, `Average → average`, `Total → total`).
 * Returns `undefined` when the point carries no value for that aggregation, so
 * callers can skip empty buckets. Pure.
 */
export function pickPointValue(point: MonitorPoint, aggregation: MetricAggregation): number | undefined {
    switch (aggregation) {
        case 'Maximum':
            return point.maximum;
        case 'Average':
            return point.average;
        case 'Total':
            return point.total;
    }
}

/**
 * Builds an Azure Monitor `$filter` scoping a Cosmos metric to a single container, to a whole
 * database (when only `databaseId` is given), or `undefined` for an account-wide query. Pure.
 */
export function containerFilter(databaseId: string | undefined, containerId: string | undefined): string | undefined {
    const clauses: string[] = [];
    if (containerId) {
        clauses.push(`CollectionName eq '${escapeODataLiteral(containerId)}'`);
    }
    if (databaseId) {
        clauses.push(`DatabaseName eq '${escapeODataLiteral(databaseId)}'`);
    }
    return clauses.length > 0 ? clauses.join(' and ') : undefined;
}

/** Escapes a value for use inside an OData single-quoted string literal (a `'` is doubled to `''`). */
function escapeODataLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

/**
 * Given the sorted timestamps whose 429 share is over threshold, keeps only the
 * ones that belong to a contiguous run long enough to count as *sustained*
 * throttling ({@link MIN_THROTTLING_DURATION_MS}). A gap larger than one and a
 * half buckets breaks a run.
 */
export function sustainedTimestamps(overThreshold: number[], bucketMs: number): Set<number> {
    const sustained = new Set<number>();
    let run: number[] = [];
    const flush = () => {
        if (run.length === 0) {
            return;
        }
        const duration = run[run.length - 1] - run[0] + bucketMs;
        if (duration >= MIN_THROTTLING_DURATION_MS) {
            run.forEach((ts) => sustained.add(ts));
        }
        run = [];
    };
    for (const ts of overThreshold) {
        if (run.length > 0 && ts - run[run.length - 1] > bucketMs * 1.5) {
            flush();
        }
        run.push(ts);
    }
    flush();

    return sustained;
}

export function containerKey(databaseId: string, containerId: string): string {
    return `${databaseId}/${containerId}`;
}

// ─── Per-partition p99 saturation signal (CODA DX-005 / DX-006) ──────────────────
//
// The hot-partition and under-provisioning rules — and the partition-health heatmap — all key off
// the same signal: each physical partition's p99 of `NormalizedRUConsumption` (already a % of the
// partition's provisioned capacity). A container is skewed ("hot partition") when the busiest
// partition is saturated while another still has headroom; it is uniformly under-provisioned when
// every partition is saturated. Keeping these constants and the classifier here is the single
// source of truth the heatmap tiles and the derived advisories both consume, so they stay aligned.

/** A physical partition's p99 at or above this % of its provisioned capacity counts as saturated. */
export const DEFAULT_PARTITION_SATURATION_PCT = 90;
/** A physical partition's p99 below this % still has headroom — used to tell skew apart from uniform saturation. */
export const DEFAULT_PARTITION_HEADROOM_PCT = 70;
/** Container 429 rate (`sum(429)/sum(total)`, %) at or above which throttling counts as active. */
export const DEFAULT_THROTTLE_RATE_PCT = 1;

/** Linear-interpolated percentile (`p` in 0..100) of the finite values; `undefined` for an empty series. Pure. */
export function percentile(values: readonly number[], p: number): number | undefined {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return undefined;
    }
    if (sorted.length === 1) {
        return sorted[0];
    }
    const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    if (low === high) {
        return sorted[low];
    }
    return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** Busiest/coolest/mean p99 across a container's physical partitions. Empty input yields all-zero stats. Pure. */
export interface PartitionSaturationStats {
    partitionCount: number;
    /** Busiest partition's p99 (is anything saturated?). */
    maxP99: number;
    /** Coolest partition's p99 (do any partitions still have headroom?). */
    minP99: number;
    meanP99: number;
}

/** Folds per-partition p99 utilizations into busiest/coolest/mean stats for the hot-partition classifier. Pure. */
export function partitionSaturationStats(p99s: readonly number[]): PartitionSaturationStats {
    const clean = p99s.filter((v) => Number.isFinite(v));
    if (clean.length === 0) {
        return { partitionCount: 0, maxP99: 0, minP99: 0, meanP99: 0 };
    }
    return {
        partitionCount: clean.length,
        maxP99: Math.max(...clean),
        minP99: Math.min(...clean),
        meanP99: clean.reduce((sum, v) => sum + v, 0) / clean.length,
    };
}

/**
 * CODA DX-006 hot-partition signal: the busiest partition is saturated (`maxP99 ≥ saturationPct`) while at least
 * one other partition still has headroom (`minP99 < headroomPct`). Requires at least two partitions — a single
 * partition cannot be skewed. Partition-count-independent (it keys off "is some partition saturated while another
 * is cool", not a ratio that scales with partition count). Uniform saturation (every partition busy) is global
 * under-provisioning (DX-005), not a hot partition, and returns `false` here. Pure.
 */
export function isHotPartition(stats: PartitionSaturationStats, saturationPct: number, headroomPct: number): boolean {
    return stats.partitionCount >= 2 && stats.maxP99 >= saturationPct && stats.minP99 < headroomPct;
}

/** Last defined value in a `timestamp → value` map, ordered by timestamp. */
export function lastValue(series: Map<number, number>): number | undefined {
    let latestTs: number | undefined;
    let latestVal: number | undefined;
    for (const [ts, val] of series) {
        if (latestTs === undefined || ts > latestTs) {
            latestTs = ts;
            latestVal = val;
        }
    }
    return latestVal;
}

/** First defined value in a `timestamp → value` map, ordered by timestamp. */
export function firstValue(series: Map<number, number>): number | undefined {
    let earliestTs: number | undefined;
    let earliestVal: number | undefined;
    for (const [ts, val] of series) {
        if (earliestTs === undefined || ts < earliestTs) {
            earliestTs = ts;
            earliestVal = val;
        }
    }
    return earliestVal;
}

/** Extracts the `databaseId/containerId` key from a timeseries' dimension metadata. */
export function seriesContainerKey(
    metadatavalues: { name?: { value?: string }; value?: string }[] | undefined,
): string | undefined {
    let database: string | undefined;
    let collection: string | undefined;
    for (const meta of metadatavalues ?? []) {
        const name = meta.name?.value?.toLowerCase();
        if (name === 'databasename') {
            database = meta.value;
        } else if (name === 'collectionname') {
            collection = meta.value;
        }
    }
    if (!collection) {
        return undefined;
    }
    return containerKey(database ?? '', collection);
}
