/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { isNonNegativeFinite, rankResourceConsumers } from './overviewMetricsModel';
import { hasMeasurement, summarizeThroughput } from './overviewThroughputModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

export function summarizeCapacity(overview: AccountOverviewState, analytics: OverviewAnalyticsState) {
    const scope = overview.selectedContainer;
    const context = {
        timeRange: overview.timeRange,
        scope,
        loading: overview.trendsLoading,
        serverless: overview.summary?.isServerless,
    };
    const throughput = summarizeThroughput(
        overview.trends.normalizedRu,
        overview.trends.provisionedThroughput,
        analytics,
        context,
    );
    const peak = hasMeasurement(throughput.consumed) ? throughput.consumed.value : undefined;
    const provisioned = hasMeasurement(throughput.provisioned) ? throughput.provisioned.value : undefined;
    const autoscale =
        !overview.trendsLoading && hasMeasurement(throughput.autoscale) ? throughput.autoscale.value : undefined;
    const matches = overview.inventory?.available
        ? overview.inventory.rows.filter(
              (row) =>
                  scope?.containerId !== undefined &&
                  row.databaseId.toLowerCase() === scope.databaseId.toLowerCase() &&
                  row.containerId.toLowerCase() === scope.containerId.toLowerCase(),
          )
        : [];
    const dedicated =
        matches.length === 1 &&
        matches[0].databaseId === scope?.databaseId &&
        matches[0].containerId === scope?.containerId &&
        matches[0].throughputMode === 'dedicated';
    const summary = overview.summary;
    const regions = new Set(
        [...(summary?.readRegions ?? []), ...(summary?.writeRegions ?? [])].map((region) =>
            region.trim().toLowerCase(),
        ),
    );
    const singleRegion =
        summary !== undefined &&
        summary.readRegionCount === summary.readRegions.length &&
        summary.writeRegionCount === summary.writeRegions.length &&
        summary.readRegionCount <= 1 &&
        summary.writeRegionCount <= 1 &&
        regions.size === 1 &&
        !regions.has('');
    const timestamp = throughput.provisionedTimestamp;
    const sameWindow =
        timestamp !== undefined &&
        analytics.data !== undefined &&
        timestamp >= analytics.data.windowStart &&
        timestamp < analytics.data.windowEnd;
    const comparable =
        summary?.isServerless === false &&
        dedicated &&
        singleRegion &&
        !overview.trendsLoading &&
        !analytics.loading &&
        !analytics.failed &&
        throughput.window !== undefined &&
        sameWindow &&
        isNonNegativeFinite(peak) &&
        isNonNegativeFinite(provisioned) &&
        provisioned > 0;
    const comparisonNote = summary?.isServerless
        ? l10n.t('Not applicable: serverless accounts do not have provisioned or autoscale capacity.')
        : comparable
          ? l10n.t(
                'Historical comparison for one dedicated manual-throughput container in a single-region account. The range peak and latest reported provisioned sample are not simultaneous; their difference is not operational headroom.',
            )
          : l10n.t(
                'Not comparable: capacity assessments require one uniquely identified dedicated manual-throughput container, a single-region account, and valid matching measurements. Account, database, shared, autoscale, and unknown scopes do not establish an allocation for consumed RU/s.',
            );
    const resources = rankResourceConsumers(
        analytics,
        context,
        overview.inventoryMetrics,
        overview.inventory ?? { available: false, rows: [] },
    );
    return {
        throughput,
        peak,
        provisioned,
        autoscale,
        comparable,
        comparisonNote,
        headroom: comparable ? Math.max(0, provisioned - peak) : undefined,
        stack: comparable && peak <= provisioned,
        resources,
        ranked: resources.rows.filter((row) => isNonNegativeFinite(row.peakBucketAverageRuPerSecond)).slice(0, 4),
    };
}
