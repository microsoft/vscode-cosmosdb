/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type MetricKey, type MetricPoint, type MetricUnit } from '../../../api/types';

// ─── Metric render descriptors (webview half of the contract) ───────────────────
//
// The webview owns the render half of each metric provider, keyed by the shared
// `MetricKey`. A descriptor carries everything `MetricTile` + `MetricChart` need to
// draw a metric without any per-metric component: the localized label, the unit
// (drives axis/tooltip formatting), the Y-axis domain, reference lines, and how the
// series collapses to the tile's scalar. Adding a metric later is one entry here.

/** A concrete container reference — a specific `databaseId` + `containerId` pair. */
export type ContainerRef = { databaseId: string; containerId: string };

/**
 * Scope that drives the metric tiles + trend chart. `undefined` is account-wide; a bare
 * `databaseId` scopes to a whole database (portal parity). A `databaseId` + `containerId` pair
 * scopes to a single container; no UI currently emits that, but the shape is kept for future
 * container-level drill-in.
 */
export type MetricScope = { databaseId: string; containerId?: string };

/** Tile render/selection order — mirrors the host `METRIC_KEYS` (webview owns its own copy). */
export const METRIC_ORDER: readonly MetricKey[] = [
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

/** How a series collapses to the single scalar shown on the tile. */
export type TilePick = 'latest' | 'peak' | 'sum';

/**
 * Emission family a metric belongs to. This is what explains the empty-state pattern on an idle
 * account: `state` gauges are reported continuously by the platform (always populated), while
 * `activity` metrics are request-path flows Azure only samples when traffic actually reaches the
 * data plane — so they read blank while the account is idle even though state tiles keep values.
 */
export type MetricGroup = 'state' | 'activity';

export interface MetricGroupMeta {
    /** Localized short legend label. */
    label: string;
    /** Localized one-line explanation shown in the legend tooltip. */
    description: string;
    /** Theme-aware accent color (VS Code chart token) used for the tile stripe and legend swatch. */
    color: string;
}

/** Color-coded metric families, rendered as a tile accent stripe plus the legend under the tiles. */
export const METRIC_GROUPS: Record<MetricGroup, MetricGroupMeta> = {
    state: {
        label: l10n.t('State'),
        description: l10n.t('Reported continuously by the platform — populated even when the account is idle.'),
        color: 'var(--vscode-charts-blue)',
    },
    activity: {
        label: l10n.t('Activity'),
        description: l10n.t('Sampled only when requests reach the account — blank while there is no traffic.'),
        color: 'var(--vscode-charts-purple)',
    },
};

export interface MetricViewDescriptor {
    key: MetricKey;
    /** Localized tile/section label. */
    label: string;
    /** Localized description of the value series, used in the tooltip + chart aria. */
    seriesLabel: string;
    unit: MetricUnit;
    /** `zeroTo100` pins percentage axes to 0–100 (padded to the peak); `auto` fits the data. */
    yDomain: 'zeroTo100' | 'auto';
    referenceLines?: { value: number; label: string }[];
    tilePick: TilePick;
    /** Emission family — drives the tile accent color and legend grouping. */
    group: MetricGroup;
}

export const METRIC_VIEWS: Record<MetricKey, MetricViewDescriptor> = {
    normalizedRu: {
        key: 'normalizedRu',
        label: l10n.t('Normalized RU'),
        seriesLabel: l10n.t('Normalized RU'),
        unit: 'percent',
        yDomain: 'zeroTo100',
        referenceLines: [{ value: 100, label: l10n.t('Provisioned (100%)') }],
        tilePick: 'peak',
        group: 'state',
    },
    totalRequests: {
        key: 'totalRequests',
        label: l10n.t('Total requests'),
        seriesLabel: l10n.t('Requests'),
        unit: 'count',
        yDomain: 'auto',
        tilePick: 'sum',
        group: 'activity',
    },
    totalRequestUnits: {
        key: 'totalRequestUnits',
        label: l10n.t('Total request units'),
        seriesLabel: l10n.t('Request units'),
        unit: 'count',
        yDomain: 'auto',
        tilePick: 'sum',
        group: 'activity',
    },
    metadataRequests: {
        key: 'metadataRequests',
        label: l10n.t('Metadata requests'),
        seriesLabel: l10n.t('Metadata requests'),
        unit: 'count',
        yDomain: 'auto',
        tilePick: 'sum',
        group: 'activity',
    },
    serverLatency: {
        key: 'serverLatency',
        label: l10n.t('Server-side latency'),
        seriesLabel: l10n.t('Latency'),
        unit: 'ms',
        yDomain: 'auto',
        tilePick: 'peak',
        group: 'activity',
    },
    serviceAvailability: {
        key: 'serviceAvailability',
        label: l10n.t('Service availability'),
        seriesLabel: l10n.t('Availability'),
        unit: 'percent',
        yDomain: 'zeroTo100',
        referenceLines: [{ value: 100, label: `100%` }],
        tilePick: 'latest',
        group: 'activity',
    },
    dataIndexUsage: {
        key: 'dataIndexUsage',
        label: l10n.t('Data + index usage'),
        seriesLabel: l10n.t('Storage'),
        unit: 'bytes',
        yDomain: 'auto',
        tilePick: 'latest',
        group: 'state',
    },
    provisionedThroughput: {
        key: 'provisionedThroughput',
        label: l10n.t('Provisioned throughput'),
        seriesLabel: l10n.t('Throughput'),
        unit: 'ru',
        yDomain: 'auto',
        tilePick: 'latest',
        group: 'state',
    },
    documentCount: {
        key: 'documentCount',
        label: l10n.t('Document count'),
        seriesLabel: l10n.t('Documents'),
        unit: 'count',
        yDomain: 'auto',
        tilePick: 'latest',
        group: 'state',
    },
};

function lastValue(points: readonly MetricPoint[]): number | undefined {
    for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].value !== undefined) {
            return points[i].value;
        }
    }
    return undefined;
}

/** Collapses a series to the tile's scalar using the descriptor's {@link TilePick}. */
export function tileScalar(
    descriptor: MetricViewDescriptor,
    points: readonly MetricPoint[],
    peak: number | undefined,
): number | undefined {
    switch (descriptor.tilePick) {
        case 'peak':
            return peak;
        case 'latest':
            return lastValue(points);
        case 'sum': {
            let sum: number | undefined;
            for (const p of points) {
                if (p.value !== undefined) {
                    sum = (sum ?? 0) + p.value;
                }
            }
            return sum;
        }
    }
}

function formatCompact(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) {
        return `${Math.round(value / 100_000_000) / 10}B`;
    }
    if (abs >= 1_000_000) {
        return `${Math.round(value / 100_000) / 10}M`;
    }
    if (abs >= 1_000) {
        return `${Math.round(value / 100) / 10}k`;
    }
    return String(Math.round(value));
}

function formatBytes(value: number): string {
    const GB = 1024 * 1024 * 1024;
    const MB = 1024 * 1024;
    const KB = 1024;
    if (value >= GB) {
        return `${Math.round((value / GB) * 10) / 10} GB`;
    }
    if (value >= MB) {
        return `${Math.round((value / MB) * 10) / 10} MB`;
    }
    if (value >= KB) {
        return `${Math.round((value / KB) * 10) / 10} KB`;
    }
    return `${Math.round(value)} B`;
}

/** Formats a metric value for a tile scalar or tooltip, per the metric's unit. */
export function formatMetricValue(unit: MetricUnit, value: number | undefined): string {
    // Treat a missing, NaN, or Infinite value the same: a non-finite number can never format
    // meaningfully, so fall back to the em-dash placeholder instead of rendering literal "NaN".
    if (value === undefined || !Number.isFinite(value)) {
        return '—';
    }
    switch (unit) {
        case 'percent':
            return `${Math.round(value)}%`;
        case 'ms':
            return `${Math.round(value)} ms`;
        case 'bytes':
            return formatBytes(value);
        case 'ru':
            return `${formatCompact(value)} RU/s`;
        case 'count':
            return formatCompact(value);
    }
}

/** Formats a Y-axis tick for the chart, per the metric's unit (compact, no unit words). */
export function formatAxisTick(unit: MetricUnit, value: number): string {
    switch (unit) {
        case 'percent':
            return `${value}%`;
        case 'bytes':
            return formatBytes(value);
        case 'ms':
        case 'ru':
        case 'count':
            return formatCompact(value);
    }
}
