/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import {
    type ContainerMetrics,
    type HealthState,
    type InventoryContainerRow,
    type MetricKey,
    type MetricSeriesResult,
    type ThroughputMode,
    type TimeRange,
} from '../../api/types';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { formatSummaryValue } from '../AccountOverviewV2/overviewMetricsModel';

export const TIME_RANGES: readonly TimeRange[] = ['1H', '24H', '7D'];

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
    '1H': l10n.t('Last hour'),
    '24H': l10n.t('Last 24 hours'),
    '7D': l10n.t('Last 7 days'),
};

export function formatBytes(bytes: number | undefined | null): string {
    return bytes === undefined || bytes === null ? l10n.t('N/A') : formatSummaryValue({ value: bytes, unit: 'bytes' });
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const grouped = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatCount(value: number | undefined | null, compactThreshold = 10_000): string {
    if (value === undefined || value === null || !Number.isFinite(value)) {
        return l10n.t('N/A');
    }
    return value >= compactThreshold ? compact.format(value) : grouped.format(value);
}

export function formatPercent(value: number | undefined | null, digits = 0): string {
    if (value === undefined || value === null || !Number.isFinite(value)) {
        return l10n.t('N/A');
    }
    return `${value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

export function formatRu(value: number | undefined | null): string {
    if (value === undefined || value === null || !Number.isFinite(value)) {
        return l10n.t('N/A');
    }
    return l10n.t('{ru} RU/s', { ru: formatCount(value, 100_000) });
}

export type Tone = 'success' | 'warning' | 'danger' | 'informative' | 'subtle';

/** A throttling-rate change in percentage points, at the precision a reader compares by eye. */
export function formatDelta(delta: number): string {
    const value = Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    return l10n.t('{sign}{value} pp', { sign: delta > 0 ? '+' : delta < 0 ? '−' : '', value });
}

export const HEALTH_PRESENTATION: Record<HealthState, { label: string; tone: Tone }> = {
    Healthy: { label: l10n.t('Healthy'), tone: 'success' },
    'Needs Attention': { label: l10n.t('Needs attention'), tone: 'warning' },
    Critical: { label: l10n.t('Critical'), tone: 'danger' },
};

const HEALTH_RANK: Record<HealthState, number> = { Healthy: 0, 'Needs Attention': 1, Critical: 2 };

export function worstHealth(states: readonly (HealthState | undefined)[]): HealthState | undefined {
    return states.reduce<HealthState | undefined>(
        (worst, state) =>
            state === undefined ? worst : !worst || HEALTH_RANK[state] > HEALTH_RANK[worst] ? state : worst,
        undefined,
    );
}

export function peakTone(percent: number | undefined): Tone {
    return percent === undefined ? 'subtle' : percent >= 90 ? 'danger' : percent >= 80 ? 'warning' : 'informative';
}

const THROUGHPUT_LABELS: Record<ThroughputMode, string> = {
    dedicated: l10n.t('Manual'),
    shared: l10n.t('Shared'),
    autoscale: l10n.t('Autoscale'),
    serverless: l10n.t('Serverless'),
    unknown: l10n.t('Unknown'),
};

export function describeThroughput(row: Pick<InventoryContainerRow, 'throughputMode' | 'throughputRU'>): string {
    const mode = THROUGHPUT_LABELS[row.throughputMode];
    if (row.throughputRU === undefined) {
        return mode;
    }
    return row.throughputMode === 'autoscale'
        ? l10n.t('{mode} · max {ru}', { mode, ru: formatRu(row.throughputRU) })
        : l10n.t('{mode} · {ru}', { mode, ru: formatRu(row.throughputRU) });
}

/** One inventory row at either level; a database row aggregates its containers. */
export interface InventoryRow {
    name: string;
    databaseId: string;
    containerId?: string;
    storageBytes?: number;
    indexBytes?: number;
    documents?: number;
    childCount?: number;
    throughput: string;
    partitionKey?: string;
    peakRuPercent?: number;
    health?: HealthState;
    throttled: boolean;
}

function metricsFor(overview: AccountOverviewState, row: InventoryContainerRow): ContainerMetrics | undefined {
    const snapshot = overview.inventoryMetrics;
    return snapshot?.available ? snapshot.metrics[`${row.databaseId}/${row.containerId}`] : undefined;
}

const sum = (values: (number | undefined)[]): number | undefined =>
    values.reduce<number | undefined>(
        (total, value) => (value === undefined ? total : (total ?? 0) + value),
        undefined,
    );

export function containerRows(overview: AccountOverviewState, databaseId: string): InventoryRow[] {
    return (overview.inventory?.rows ?? [])
        .filter((row) => row.databaseId === databaseId)
        .map((row) => {
            const metrics = metricsFor(overview, row);
            return {
                name: row.containerId,
                databaseId: row.databaseId,
                containerId: row.containerId,
                storageBytes: metrics?.storageBytes,
                indexBytes: metrics?.indexUsageBytes,
                documents: metrics?.documentCount,
                throughput: describeThroughput(row),
                partitionKey: row.partitionKeyPaths.join(', '),
                peakRuPercent: metrics?.peakRuPercent,
                health: metrics?.health,
                throttled: metrics?.throttled ?? false,
            };
        });
}

export function databaseRows(overview: AccountOverviewState): InventoryRow[] {
    const rows = overview.inventory?.rows ?? [];
    const names = overview.inventory?.databases ?? [...new Set(rows.map((row) => row.databaseId))];
    return names.map((databaseId) => {
        const children = containerRows(overview, databaseId);
        const inventoryRows = rows.filter((row) => row.databaseId === databaseId);
        const shared = inventoryRows.find((row) => row.throughputMode === 'shared');
        const peaks = children.map((child) => child.peakRuPercent).filter((value) => value !== undefined);
        return {
            name: databaseId,
            databaseId,
            storageBytes: sum(children.map((child) => child.storageBytes)),
            indexBytes: sum(children.map((child) => child.indexBytes)),
            documents: sum(children.map((child) => child.documents)),
            childCount: children.length,
            throughput: shared
                ? describeThroughput(shared)
                : children.length === 0
                  ? l10n.t('None')
                  : l10n.t('Per container'),
            peakRuPercent: peaks.length > 0 ? Math.max(...peaks) : undefined,
            health: worstHealth(children.map((child) => child.health)),
            throttled: children.some((child) => child.throttled),
        };
    });
}

/** Values of a series for a sparkline; gaps are dropped (a sparkline is a shape, not a measurement). */
export function seriesValues(series: MetricSeriesResult | undefined): number[] {
    return series?.available
        ? series.points.map((point) => point.value).filter((value): value is number => value !== undefined)
        : [];
}

export function latestValue(series: MetricSeriesResult | undefined): number | undefined {
    return seriesValues(series).at(-1);
}

export function sumValues(series: MetricSeriesResult | undefined): number | undefined {
    const values = seriesValues(series);
    return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0);
}

/** `undefined` while the first read is in flight so a metric card renders its skeleton; `null` when unavailable. */
export function tileState<T>(
    overview: AccountOverviewState,
    key: MetricKey,
    read: (series: MetricSeriesResult) => T | undefined,
): T | null | undefined {
    const series = overview.trends[key];
    if (!series) {
        return overview.trendsLoading ? undefined : null;
    }
    if (!series.available) {
        return null;
    }
    return read(series) ?? null;
}

export function scopeLabel(overview: AccountOverviewState): string {
    return overview.selectedContainer
        ? l10n.t('Database {name}', { name: overview.selectedContainer.databaseId })
        : l10n.t('Account-wide');
}
