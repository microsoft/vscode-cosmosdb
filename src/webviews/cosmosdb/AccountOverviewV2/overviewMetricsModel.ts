/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import {
    type ContainerMetrics,
    type InventoryContainerRow,
    type InventoryMetricsResult,
    type MetricKey,
    type MetricPoint,
    type MetricSeriesResult,
    type PartitionHealthResult,
    type TimeRange,
} from '../../api/types';
import { type MetricScope } from '../AccountOverview/metrics/descriptors';
import { unavailableSummary } from './overviewFindingsModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

export type SummaryState = 'ready' | 'partial' | 'loading' | 'stale' | 'unavailable';
export interface MetricSummary {
    state: SummaryState;
    value?: number;
    label: string;
    unit: '%' | 'ms' | 'RU' | 'RU/s' | 'bytes' | 'requests' | 'documents';
    detail: string;
}

const METRICS: Record<
    MetricKey,
    { label: () => string; unit: MetricSummary['unit']; statistic: 'peak' | 'latest' | 'sum' }
> = {
    normalizedRu: { label: () => l10n.t('Period peak normalized RU'), unit: '%', statistic: 'peak' },
    totalRequests: { label: () => l10n.t('Requests in reported intervals'), unit: 'requests', statistic: 'sum' },
    totalRequestUnits: { label: () => l10n.t('Consumed RU in reported intervals'), unit: 'RU', statistic: 'sum' },
    metadataRequests: {
        label: () => l10n.t('Metadata requests in reported intervals'),
        unit: 'requests',
        statistic: 'sum',
    },
    serverLatency: { label: () => l10n.t('Peak interval-average server latency'), unit: 'ms', statistic: 'peak' },
    serviceAvailability: {
        label: () => l10n.t('Latest reported average availability'),
        unit: '%',
        statistic: 'latest',
    },
    dataIndexUsage: { label: () => l10n.t('Latest reported data + index storage'), unit: 'bytes', statistic: 'latest' },
    provisionedThroughput: {
        label: () => l10n.t('Latest reported maximum provisioned throughput'),
        unit: 'RU/s',
        statistic: 'latest',
    },
    documentCount: { label: () => l10n.t('Latest reported document count'), unit: 'documents', statistic: 'latest' },
};

export const isNonNegativeFinite = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value >= 0;

/** Keep unusable values as gaps so a chart never implies a measurement where none was reported. */
export function metricSamples(series: MetricSeriesResult, percent: boolean): MetricPoint[] {
    return series.points
        .filter((point) => Number.isFinite(point.timestamp) && !Number.isNaN(new Date(point.timestamp).getTime()))
        .map((point) => ({
            ...point,
            value: isNonNegativeFinite(point.value) && (!percent || point.value <= 100) ? point.value : undefined,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
}

export function summarizeOverviewAnalytics(
    analytics: OverviewAnalyticsState | undefined,
    context: { timeRange: TimeRange; scope?: MetricScope },
): { throttling: MetricSummary; consumed: MetricSummary; window?: string } {
    const throttling: MetricSummary = {
        state: 'unavailable',
        label: l10n.t('429 throttling rate'),
        unit: '%',
        detail: l10n.t('Resource analytics have not loaded.'),
    };
    const consumed: MetricSummary = {
        ...throttling,
        label: l10n.t('Peak bucket-average consumed RU/s'),
        unit: 'RU/s',
    };
    const unavailable = (state: SummaryState, detail: string) => ({
        throttling: { ...throttling, state, detail },
        consumed: { ...consumed, state, detail },
    });
    if (analytics?.loading) {
        return unavailable('loading', l10n.t('Updating selected scope and window…'));
    }
    if (analytics?.failed) {
        return unavailable(
            'unavailable',
            l10n.t('Additional throughput analytics could not be loaded. Use Refresh to retry.'),
        );
    }
    const data = analytics?.data;
    if (!data) {
        return { throttling, consumed };
    }
    if (
        data.timeRange !== context.timeRange ||
        data.databaseId !== context.scope?.databaseId ||
        data.containerId !== context.scope?.containerId
    ) {
        return unavailable('stale', l10n.t('Resource analytics do not match the selected scope or time window.'));
    }
    if (
        !Number.isFinite(data.windowStart) ||
        !Number.isFinite(data.windowEnd) ||
        data.windowStart >= data.windowEnd ||
        Number.isNaN(new Date(data.windowStart).getTime()) ||
        Number.isNaN(new Date(data.windowEnd).getTime())
    ) {
        return unavailable('unavailable', l10n.t('Resource analytics did not provide a valid measurement window.'));
    }
    const rate = data.throttling;
    const ru = data.consumedRu;
    const validRate =
        rate.available &&
        isNonNegativeFinite(rate.ratePercent) &&
        rate.ratePercent <= 100 &&
        isNonNegativeFinite(rate.totalRequests) &&
        rate.totalRequests > 0 &&
        isNonNegativeFinite(rate.throttledRequests) &&
        rate.throttledRequests <= rate.totalRequests;
    const validRu =
        ru.available &&
        isNonNegativeFinite(ru.peakBucketAverageRuPerSecond) &&
        Number.isFinite(ru.bucketSeconds) &&
        ru.bucketSeconds > 0;
    return {
        throttling: {
            ...throttling,
            state: validRate ? 'ready' : 'unavailable',
            value: validRate ? rate.ratePercent : undefined,
            detail: validRate
                ? l10n.t('{throttled} of {total} measured requests returned 429.', {
                      throttled: rate.throttledRequests!,
                      total: rate.totalRequests!,
                  })
                : rate.totalRequests === 0
                  ? l10n.t('No measured requests; a 429 rate is undefined.')
                  : unavailableSummary(rate.reason),
        },
        consumed: {
            ...consumed,
            state: validRu ? 'ready' : 'unavailable',
            value: validRu ? ru.peakBucketAverageRuPerSecond : undefined,
            detail: validRu
                ? l10n.t('Maximum bucket RU divided by {seconds} seconds; not an instantaneous peak.', {
                      seconds: ru.bucketSeconds,
                  })
                : unavailableSummary(ru.reason),
        },
        window: l10n.t('Rate and RU/s use complete buckets from {start} to {end}.', {
            start: new Date(data.windowStart).toLocaleString(),
            end: new Date(data.windowEnd).toLocaleString(),
        }),
    };
}

export function summarizeMetric(
    metric: MetricKey,
    series: MetricSeriesResult | undefined,
    context: { timeRange: TimeRange; scope?: MetricScope; loading: boolean },
): MetricSummary {
    const definition = METRICS[metric];
    const base = { label: definition.label(), unit: definition.unit };
    if (context.loading) {
        return { ...base, state: 'loading', detail: l10n.t('Updating selected scope and window…') };
    }
    if (!series) {
        return { ...base, state: 'unavailable', detail: l10n.t('No metric snapshot has been loaded.') };
    }
    if (
        series.metric !== metric ||
        series.timeRange !== context.timeRange ||
        series.databaseId !== context.scope?.databaseId ||
        series.containerId !== context.scope?.containerId
    ) {
        return {
            ...base,
            state: 'stale',
            detail: l10n.t('Snapshot does not match the selected scope or time window.'),
        };
    }
    if (!series.available) {
        return { ...base, state: 'unavailable', detail: unavailableSummary(series.reason) };
    }
    const points = metricSamples(series, definition.unit === '%').filter((point) => point.value !== undefined);
    if (points.length === 0) {
        return {
            ...base,
            state: 'unavailable',
            detail: l10n.t('No finite samples were reported; this is not a measured zero.'),
        };
    }
    const value =
        definition.statistic === 'sum'
            ? points.reduce((sum, point) => sum + point.value!, 0)
            : definition.statistic === 'latest'
              ? points[points.length - 1].value!
              : points.reduce((peak, point) => Math.max(peak, point.value!), 0);
    if (!Number.isFinite(value)) {
        return { ...base, state: 'unavailable', detail: l10n.t('The aggregate exceeds the supported numeric range.') };
    }
    const partial = points.length !== series.points.length;
    return {
        ...base,
        state: partial ? 'partial' : 'ready',
        value,
        detail: partial
            ? l10n.t('Partial samples: {valid} of {total} returned intervals are usable.', {
                  valid: points.length,
                  total: series.points.length,
              })
            : l10n.t('Based on {count} reported intervals; missing intervals are not filled with zero.', {
                  count: points.length,
              }),
    };
}

export function formatSummaryValue(summary: Pick<MetricSummary, 'value' | 'unit'>): string {
    if (!isNonNegativeFinite(summary.value)) {
        return '—';
    }
    const value = summary.value;
    if (summary.unit === 'bytes') {
        const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
        const power = value === 0 ? 0 : Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
        const index = Math.max(0, power);
        return `${(value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[index]}`;
    }
    if (summary.unit === '%') {
        const precision = { maximumFractionDigits: 5 };
        if (value > 0 && value < 0.00001) {
            return `<${(0.00001).toLocaleString(undefined, precision)}%`;
        }
        if (value < 100 && value > 99.99999) {
            return `>${(99.99999).toLocaleString(undefined, precision)}%`;
        }
        return `${value.toLocaleString(undefined, precision)}%`;
    }
    const text = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (summary.unit === 'requests' || summary.unit === 'documents') {
        return text;
    }
    return `${text} ${summary.unit}`;
}

export function rankResourcePeaks(
    snapshot: (InventoryMetricsResult & { timeRange?: TimeRange }) | undefined,
    timeRange: TimeRange,
): { state: SummaryState; rows: ContainerMetrics[]; detail: string } {
    if (!snapshot) {
        return { state: 'loading', rows: [], detail: l10n.t('Waiting for inventory telemetry…') };
    }
    if (!snapshot.available) {
        return { state: 'unavailable', rows: [], detail: unavailableSummary(snapshot.reason) };
    }
    if (snapshot.timeRange !== timeRange) {
        return {
            state: 'stale',
            rows: [],
            detail: snapshot.timeRange
                ? l10n.t('Inventory telemetry is for a different time window.')
                : l10n.t('The inventory snapshot does not identify its peak measurement window.'),
        };
    }
    const allRows = Object.values(snapshot.metrics);
    const rows = allRows.filter((row) => isNonNegativeFinite(row.peakRuPercent) && row.peakRuPercent <= 100);
    rows.sort(
        (a, b) =>
            b.peakRuPercent! - a.peakRuPercent! ||
            (a.databaseId < b.databaseId ? -1 : a.databaseId > b.databaseId ? 1 : 0) ||
            (a.containerId < b.containerId ? -1 : a.containerId > b.containerId ? 1 : 0),
    );
    return {
        state: rows.length === 0 ? 'unavailable' : rows.length < allRows.length ? 'partial' : 'ready',
        rows,
        detail: l10n.t(
            '{measured} of {reported} telemetry rows have a usable normalized RU peak. Inventory coverage may be incomplete.',
            { measured: rows.length, reported: allRows.length },
        ),
    };
}

export interface RankedResourceConsumer {
    databaseId: string;
    containerId: string;
    peakBucketAverageRuPerSecond?: number;
    bucketSeconds: number;
    ratePercent?: number;
    throttlingDetail: string;
    inventory?: ContainerMetrics;
}

type ResourceIdentity = Pick<InventoryContainerRow, 'databaseId' | 'containerId'>;

function resourceKey(resource: ResourceIdentity): string {
    return `${resource.databaseId}/${resource.containerId}`;
}

function isNamedResource(resource: ResourceIdentity): boolean {
    return [resource.databaseId, resource.containerId].every(
        (part) => part.trim().length > 0 && part.trim().toLowerCase() !== '<empty>',
    );
}

function indexResourceIdentities<T extends ResourceIdentity>(resources: readonly T[]): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const resource of resources) {
        const key = resourceKey(resource).toLowerCase();
        const matches = result.get(key) ?? [];
        matches.push(resource);
        result.set(key, matches);
    }
    return result;
}

/** Measured consumption ranks first; unmatched inventory remains explicitly unmeasured, never an aggregate proxy. */
export function rankResourceConsumers(
    analytics: OverviewAnalyticsState,
    context: { timeRange: TimeRange; scope?: MetricScope },
    inventory?: InventoryMetricsResult,
    resourceInventory?: { available: boolean; rows: readonly ResourceIdentity[] },
): { state: SummaryState; rows: RankedResourceConsumer[]; detail: string; windowStart?: number; windowEnd?: number } {
    if (analytics.loading) {
        return { state: 'loading', rows: [], detail: l10n.t('Updating resource consumption for the selected scope…') };
    }
    if (analytics.failed || !analytics.data) {
        return {
            state: 'unavailable',
            rows: [],
            detail: analytics.failed
                ? l10n.t('Resource analytics could not be retrieved. Refresh to try again.')
                : l10n.t('Resource analytics have not loaded.'),
        };
    }
    const data = analytics.data;
    if (
        data.timeRange !== context.timeRange ||
        data.databaseId !== context.scope?.databaseId ||
        data.containerId !== context.scope?.containerId
    ) {
        return {
            state: 'stale',
            rows: [],
            detail: l10n.t('Resource analytics do not match the selected scope or time window.'),
        };
    }
    if (
        !Number.isFinite(data.windowStart) ||
        !Number.isFinite(data.windowEnd) ||
        data.windowStart >= data.windowEnd ||
        Number.isNaN(new Date(data.windowStart).getTime()) ||
        Number.isNaN(new Date(data.windowEnd).getTime())
    ) {
        return {
            state: 'unavailable',
            rows: [],
            detail: l10n.t('Resource analytics did not provide a valid measurement window.'),
        };
    }
    if (resourceInventory && !resourceInventory.available) {
        return {
            state: 'unavailable',
            rows: [],
            detail: l10n.t('Resource inventory is unavailable; measured activity cannot be matched to containers.'),
            windowStart: data.windowStart,
            windowEnd: data.windowEnd,
        };
    }
    const resources = Object.values(data.resources);
    const inventoryRows = resourceInventory?.rows.filter(isNamedResource);
    const inventoryIdentities = inventoryRows && indexResourceIdentities(inventoryRows);
    const metricIdentities = indexResourceIdentities(resources);
    const inScope = (resource: ResourceIdentity): boolean =>
        (context.scope?.databaseId === undefined || resource.databaseId === context.scope.databaseId) &&
        (context.scope?.containerId === undefined || resource.containerId === context.scope.containerId);
    const scopedInventory = inventoryRows?.filter(inScope);
    const metadataIdentities = indexResourceIdentities(
        inventory?.available && inventory.timeRange === context.timeRange
            ? Object.entries(inventory.metrics)
                  .filter(([key, resource]) => key === resourceKey(resource) && isNamedResource(resource))
                  .map(([, resource]) => resource)
            : [],
    );
    const metadataFor = (resource: ResourceIdentity): ContainerMetrics | undefined => {
        const matches = metadataIdentities.get(resourceKey(resource).toLowerCase());
        const canonicalMatches = inventoryIdentities?.get(resourceKey(resource).toLowerCase());
        if (
            matches?.length !== 1 ||
            (inventoryIdentities ? canonicalMatches?.length !== 1 : resourceKey(matches[0]) !== resourceKey(resource))
        ) {
            return undefined;
        }
        return { ...matches[0], databaseId: resource.databaseId, containerId: resource.containerId };
    };
    const rows: RankedResourceConsumer[] = [];
    for (const resource of resources) {
        if (!isNamedResource(resource)) {
            continue;
        }
        const key = resourceKey(resource).toLowerCase();
        const matches = inventoryIdentities?.get(key);
        // Azure dimension casing cannot distinguish colliding inventory names or duplicate telemetry identities.
        const identity = inventoryIdentities ? (matches?.length === 1 ? matches[0] : undefined) : resource;
        if (!identity || !inScope(identity) || metricIdentities.get(key)?.length !== 1) {
            continue;
        }
        const consumed = resource.consumedRu;
        if (
            !consumed.available ||
            !isNonNegativeFinite(consumed.peakBucketAverageRuPerSecond) ||
            !Number.isFinite(consumed.bucketSeconds) ||
            consumed.bucketSeconds <= 0
        ) {
            continue;
        }
        const throttling = resource.throttling;
        const measuredRate =
            throttling.available &&
            isNonNegativeFinite(throttling.ratePercent) &&
            throttling.ratePercent <= 100 &&
            isNonNegativeFinite(throttling.totalRequests) &&
            throttling.totalRequests > 0 &&
            isNonNegativeFinite(throttling.throttledRequests) &&
            throttling.throttledRequests <= throttling.totalRequests;
        rows.push({
            databaseId: identity.databaseId,
            containerId: identity.containerId,
            peakBucketAverageRuPerSecond: consumed.peakBucketAverageRuPerSecond,
            bucketSeconds: consumed.bucketSeconds,
            ratePercent: measuredRate ? throttling.ratePercent : undefined,
            throttlingDetail: measuredRate
                ? l10n.t('{throttled} of {total} measured requests returned 429.', {
                      throttled: throttling.throttledRequests!,
                      total: throttling.totalRequests!,
                  })
                : throttling.totalRequests === 0
                  ? l10n.t('No measured requests; a 429 rate is undefined.')
                  : unavailableSummary(throttling.reason),
            inventory: metadataFor(identity),
        });
    }
    const measuredCount = rows.length;
    const measuredKeys = new Set(rows.map(resourceKey));
    for (const resource of scopedInventory ?? []) {
        if (!measuredKeys.has(resourceKey(resource))) {
            rows.push({
                databaseId: resource.databaseId,
                containerId: resource.containerId,
                bucketSeconds: data.consumedRu.bucketSeconds,
                throttlingDetail: l10n.t(
                    'No uniquely matched consumed RU measurement is available for this container.',
                ),
                inventory: metadataFor(resource),
            });
        }
    }
    rows.sort(
        (a, b) =>
            (b.peakBucketAverageRuPerSecond ?? -1) - (a.peakBucketAverageRuPerSecond ?? -1) ||
            (a.databaseId < b.databaseId ? -1 : a.databaseId > b.databaseId ? 1 : 0) ||
            (a.containerId < b.containerId ? -1 : a.containerId > b.containerId ? 1 : 0),
    );
    const partial =
        !data.resourcesComplete || measuredCount < resources.length || measuredCount < (scopedInventory?.length ?? 0);
    const coverage = data.resourcesComplete
        ? l10n.t('The resource-split queries completed.')
        : l10n.t('Incomplete resource-split coverage: {reason}', { reason: unavailableSummary(data.resourcesReason) });
    return {
        state: measuredCount === 0 ? 'unavailable' : partial ? 'partial' : 'ready',
        rows,
        detail: scopedInventory
            ? l10n.t(
                  '{measured} of {reported} inventory containers have matched consumed RU measurements. Unmeasured containers are unranked. Unattributed activity is excluded. {coverage}',
                  { measured: measuredCount, reported: scopedInventory.length, coverage },
              )
            : l10n.t(
                  '{measured} of {reported} returned resources have measured consumed RU and can be ranked. {coverage}',
                  { measured: measuredCount, reported: resources.length, coverage },
              ),
        windowStart: data.windowStart,
        windowEnd: data.windowEnd,
    };
}

export function formatByteChange(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) {
        return '—';
    }
    const magnitude = formatSummaryValue({ value: Math.abs(value), unit: 'bytes' });
    return value < 0 ? `−${magnitude}` : value > 0 ? `+${magnitude}` : magnitude;
}

export function summarizePartition(
    snapshot: (PartitionHealthResult & { timeRange?: TimeRange }) | undefined,
    context: {
        container?: { databaseId: string; containerId: string };
        mode: 'ru' | 'storage';
        timeRange: TimeRange;
        loading: boolean;
    },
): MetricSummary {
    const base = {
        label:
            context.mode === 'ru'
                ? l10n.t('Busiest partition p99 normalized RU')
                : l10n.t('Largest physical partition storage share'),
        unit: '%' as const,
    };
    if (!context.container) {
        return {
            ...base,
            state: 'unavailable',
            detail: l10n.t('Select a container in partition details to inspect its distribution.'),
        };
    }
    if (context.loading) {
        return { ...base, state: 'loading', detail: l10n.t('Updating partition telemetry…') };
    }
    if (!snapshot) {
        return { ...base, state: 'unavailable', detail: l10n.t('No partition snapshot has been loaded.') };
    }
    if (
        snapshot.databaseId !== context.container.databaseId ||
        snapshot.containerId !== context.container.containerId ||
        snapshot.mode !== context.mode ||
        snapshot.timeRange !== context.timeRange
    ) {
        return {
            ...base,
            state: 'stale',
            detail: l10n.t('Partition snapshot does not confirm the selected container, mode and time window.'),
        };
    }
    if (!snapshot.available) {
        return { ...base, state: 'unavailable', detail: unavailableSummary(snapshot.reason) };
    }
    const value = context.mode === 'ru' ? snapshot.maxSaturationPercent : snapshot.topPartitionShare;
    if (!isNonNegativeFinite(value) || value > 100 || snapshot.partitionCount <= 0 || snapshot.tiles.length === 0) {
        return {
            ...base,
            state: 'unavailable',
            detail: l10n.t('No usable physical-partition measurements were returned.'),
        };
    }
    return {
        ...base,
        state: snapshot.tiles.length < snapshot.partitionCount ? 'partial' : 'ready',
        value,
        detail:
            context.mode === 'ru'
                ? l10n.t('Percent of provisioned RU on the busiest physical partition, not a share of consumed RU.')
                : l10n.t('Share of reported physical-partition storage, not a growth rate.'),
    };
}
