/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MetricAggregation, type TimeRange, type UnavailableReason } from '../services/shared';
import { type StorageMeasurement } from './storage';

// ─── Metric provider contract (shared, pure) ────────────────────────────────────
//
// The single source of truth that both sides of the tRPC boundary agree on. It is
// intentionally free of `@azure/*` and React so the webview can import it (types
// only, per repo convention) without pulling host/Node code into the bundle. Fetch
// (host) and render (webview) each own their half of the descriptor keyed by
// {@link MetricKey}; only this key set and the wire shapes below are shared.

export { type MetricAggregation };

/**
 * Every metric the dashboard can surface as a tile → chart. Some are shown today
 * (P0), the rest land behind the same contract in later phases — the key set is
 * the growth point, so adding a metric is a one-entry change on each side.
 */
export type MetricKey =
    | 'normalizedRu'
    | 'totalRequests'
    | 'totalRequestUnits'
    | 'metadataRequests'
    | 'serverLatency'
    | 'serviceAvailability'
    | 'dataIndexUsage'
    | 'provisionedThroughput'
    | 'documentCount';

/** Stable render/fetch order for the tile row. */
export const METRIC_KEYS: readonly MetricKey[] = [
    'normalizedRu',
    'totalRequests',
    'totalRequestUnits',
    'metadataRequests',
    'serverLatency',
    'serviceAvailability',
    'dataIndexUsage',
    'provisionedThroughput',
    'documentCount',
];

export type MetricInapplicabilityReason = 'serverlessNormalizedRu' | 'serverlessProvisionedThroughput';

/** Applicability is independent of observations, request failures, and the State / Activity emission family. */
export type MetricApplicability =
    | { status: 'unknown' }
    | { status: 'applicable' }
    | { status: 'notApplicable'; reason: MetricInapplicabilityReason };

export function getMetricApplicability(metric: MetricKey, isServerless: boolean | undefined): MetricApplicability {
    if (isServerless === undefined) {
        return { status: 'unknown' };
    }
    if (isServerless && metric === 'normalizedRu') {
        return { status: 'notApplicable', reason: 'serverlessNormalizedRu' };
    }
    if (isServerless && metric === 'provisionedThroughput') {
        return { status: 'notApplicable', reason: 'serverlessProvisionedThroughput' };
    }
    return { status: 'applicable' };
}

export function getAccountMetricApplicability(
    isServerless: boolean | undefined,
): Record<MetricKey, MetricApplicability> {
    return Object.fromEntries(
        METRIC_KEYS.map((metric) => [metric, getMetricApplicability(metric, isServerless)]),
    ) as Record<MetricKey, MetricApplicability>;
}

/** Metric-specific failures do not change the shared unavailable contract used by health and advisories. */
export type MetricUnavailableReason = UnavailableReason | 'error';

/**
 * Azure Monitor aggregation to read for a metric. Re-exported from the service
 * layer (`shared`) so both sides can refer to it through the contract. Each maps
 * to a distinct datapoint field — see `pickPointValue`.
 */

/** Physical unit of a metric's values, driving axis/tooltip formatting in the webview. */
export type MetricUnit = 'percent' | 'ms' | 'count' | 'bytes' | 'ru';

/** A single time-bucketed sample of a metric series. */
export interface MetricPoint {
    /** Epoch milliseconds for the bucket. */
    timestamp: number;
    /** The metric's value for the bucket (in the metric's {@link MetricUnit}), when present. */
    value?: number;
    /** Storage components aligned to this exact bucket; value is present only for a complete total. */
    storage?: StorageMeasurement;
    /**
     * True when the bucket falls inside a sustained-throttling (429) window. Only
     * populated by providers that track throttling (`normalizedRu`, `totalRequests`);
     * `undefined`/`false` elsewhere.
     */
    throttled?: boolean;
}

/**
 * The wire shape returned for any metric series. Neutral across metrics — the
 * webview interprets `value`/`peak` through the metric's descriptor. Any Azure
 * Monitor failure resolves to `available: false` + a `reason` so the webview can
 * render an explicit empty-state instead of an error.
 */
export interface MetricSeriesResult {
    /** Which metric this series is for. */
    metric: MetricKey;
    applicability: MetricApplicability;
    /** False for missing observations, request failures, or known inapplicability. */
    available: boolean;
    /** Observation/fetch failure reason. Known inapplicability carries its own reason in `applicability`. */
    reason?: MetricUnavailableReason;
    points: MetricPoint[];
    /** Storage components in the latest observed bucket, including partial or failed reads. */
    storage?: StorageMeasurement;
    /** Scalar summary for the tile (peak of the series), when any value is present. */
    peak?: number;
    timeRange: TimeRange;
    databaseId?: string;
    containerId?: string;
    /** Epoch milliseconds when the host produced this snapshot. */
    generatedAt: number;
}
