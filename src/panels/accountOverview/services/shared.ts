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
 * emits the metric (`unsupported`) and a missing Azure RBAC role (`rbac`).
 */
export type UnavailableReason = 'noData' | 'unsupported' | 'rbac';

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

export interface RangeConfig {
    /** Window length in milliseconds. */
    windowMs: number;
    /** ISO-8601 duration for the metric interval (bucket size). */
    interval: string;
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

/** 429 share above which a bucket counts as throttled. */
export const THROTTLING_SHARE_THRESHOLD = 0.01;
/** A throttling run must span at least this long to be reported as sustained. */
export const MIN_THROTTLING_DURATION_MS = 5 * MINUTE;

export function isThrottledStatusCode(code: string | undefined): boolean {
    return code === '429' || code?.startsWith('429') === true;
}

/**
 * Builds an Azure Monitor `$filter` scoping a Cosmos metric to a single
 * container (and optionally its database), or `undefined` for an account-wide
 * query. Pure.
 */
export function containerFilter(databaseId: string | undefined, containerId: string | undefined): string | undefined {
    if (!containerId) {
        return undefined;
    }
    const clauses = [`CollectionName eq '${containerId}'`];
    if (databaseId) {
        clauses.push(`DatabaseName eq '${databaseId}'`);
    }
    return clauses.join(' and ');
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
