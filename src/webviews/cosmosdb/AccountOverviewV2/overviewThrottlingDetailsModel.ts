/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type InventoryContainerRow, type TimeRange } from '../../api/types';
import { type MetricScope } from '../AccountOverview/metrics/descriptors';
import { isNonNegativeFinite, summarizeOverviewAnalytics } from './overviewMetricsModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

type Identity = Pick<InventoryContainerRow, 'databaseId' | 'containerId'>;

export interface ThrottledRequestShare {
    resource?: Identity;
    count: number;
    percent: number;
}

export interface ThrottledRequestDistribution {
    total?: number;
    shares: ThrottledRequestShare[];
    detail: string;
}

const identityKey = (resource: Identity) => `${resource.databaseId}/${resource.containerId}`.toLowerCase();
const named = (resource: Identity) =>
    [resource.databaseId, resource.containerId].every(
        (part) => part.trim().length > 0 && part.trim().toLowerCase() !== '<empty>',
    );

function indexIdentities<T extends Identity>(rows: readonly T[]): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const row of rows) {
        const key = identityKey(row);
        const matches = result.get(key) ?? [];
        matches.push(row);
        result.set(key, matches);
    }
    return result;
}

/** Request-only telemetry is usable; consumed RU is deliberately not a prerequisite for attribution. */
export function throttledRequestDistribution(
    analytics: OverviewAnalyticsState,
    context: { timeRange: TimeRange; scope?: MetricScope; loading: boolean },
    inventory?: { available: boolean; rows: readonly Identity[] },
): ThrottledRequestDistribution {
    const unavailable = (detail: string, total?: number): ThrottledRequestDistribution => ({
        total,
        shares: [],
        detail,
    });
    if (context.loading || analytics.loading) {
        return unavailable(l10n.t('Updating selected scope and window…'));
    }
    const summary = summarizeOverviewAnalytics(analytics, context);
    const data = analytics.data;
    if (!data || summary.window === undefined) {
        return unavailable(summary.throttling.detail);
    }
    const aggregate = data.throttling;
    if (
        !isNonNegativeFinite(aggregate.totalRequests) ||
        !isNonNegativeFinite(aggregate.throttledRequests) ||
        aggregate.throttledRequests > aggregate.totalRequests ||
        (!aggregate.available && aggregate.totalRequests !== 0)
    ) {
        return unavailable(l10n.t('Throttled request totals are unavailable for the selected scope and window.'));
    }
    const total = aggregate.throttledRequests;
    if (total === 0) {
        return unavailable(
            l10n.t('0 throttled requests measured in this window; there is no distribution to show.'),
            0,
        );
    }
    if (!data.resourcesComplete) {
        return unavailable(
            l10n.t('Container distribution is unavailable because resource-split coverage is incomplete.'),
            total,
        );
    }

    const resources = Object.values(data.resources);
    const resourceIndex = indexIdentities(resources);
    const inventoryIndex = indexIdentities(inventory?.available ? inventory.rows : []);
    const matched: { resource: Identity; count: number }[] = [];
    let reportedTotal = 0;
    for (const [key, resource] of Object.entries(data.resources)) {
        const measurement = resource.throttling;
        if (
            !measurement.available ||
            !isNonNegativeFinite(measurement.totalRequests) ||
            !isNonNegativeFinite(measurement.throttledRequests) ||
            measurement.throttledRequests > measurement.totalRequests
        ) {
            continue;
        }
        reportedTotal += measurement.throttledRequests;
        if (!Number.isFinite(reportedTotal) || reportedTotal > total) {
            return unavailable(
                l10n.t('Container counts exceed the scope total; a reliable distribution cannot be shown.'),
                total,
            );
        }
        const normalizedKey = identityKey(resource);
        const identities = inventoryIndex.get(normalizedKey);
        const identity = identities?.length === 1 ? identities[0] : undefined;
        if (
            key.toLowerCase() !== normalizedKey ||
            !named(resource) ||
            !identity ||
            !named(identity) ||
            resourceIndex.get(normalizedKey)?.length !== 1 ||
            identity.databaseId.toLowerCase() !== resource.databaseId.toLowerCase() ||
            identity.containerId.toLowerCase() !== resource.containerId.toLowerCase() ||
            (context.scope?.databaseId !== undefined && identity.databaseId !== context.scope.databaseId) ||
            (context.scope?.containerId !== undefined && identity.containerId !== context.scope.containerId)
        ) {
            continue;
        }
        if (measurement.throttledRequests > 0) {
            matched.push({ resource: identity, count: measurement.throttledRequests });
        }
    }
    matched.sort(
        (a, b) =>
            b.count - a.count ||
            a.resource.databaseId.localeCompare(b.resource.databaseId) ||
            a.resource.containerId.localeCompare(b.resource.containerId),
    );
    const top = matched.slice(0, 3);
    const namedTotal = top.reduce((sum, item) => sum + item.count, 0);
    if (!Number.isFinite(namedTotal) || namedTotal > total) {
        return unavailable(l10n.t('Container counts cannot be reconciled with the scope total.'), total);
    }
    const shares: ThrottledRequestShare[] = top.map((item) => ({
        ...item,
        percent: (item.count / total) * 100,
    }));
    if (namedTotal < total) {
        const remainder = total - namedTotal;
        shares.push({ count: remainder, percent: (remainder / total) * 100 });
    }
    return {
        total,
        shares,
        detail: l10n.t(
            'Shares use all measured 429 requests in the selected scope and window. Up to three uniquely matched containers are shown; Other / unattributed includes remaining containers and requests that cannot be uniquely matched.',
        ),
    };
}

export function relativeThrottlingChange(
    current: number | undefined,
    previous: number | undefined,
): number | undefined {
    if (!isNonNegativeFinite(current) || !isNonNegativeFinite(previous) || previous === 0) {
        return undefined;
    }
    const change = ((current - previous) / previous) * 100;
    return Number.isFinite(change) ? change : undefined;
}
