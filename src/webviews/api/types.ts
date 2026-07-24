/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared type re-exports for webview ↔ extension communication.
 *
 * Webview (browser) code should import tRPC router types from here rather than
 * reaching into the server-side `src/panels/trpc/` directory. These are
 * type-only imports, erased at compile time, so they don't pull Node.js code
 * into the webview bundle.
 */

export type { AccountOverviewAppRouter, DocumentAppRouter, QueryEditorAppRouter } from '../../panels/trpc/appRouter';
export type {
    AccountHealthSignals,
    AlertItem,
    AlertSeverity,
    AlertsResult,
    AlertTimeRange,
    ContainerMetrics,
    DerivedAdvisoriesResult,
    DerivedAdvisory,
    DerivedAdvisoryRule,
    DerivedAdvisorySeverity,
    HealthState,
    InventoryMetricsResult,
    LogsSourceStatus,
    PartitionDistributionMode,
    PartitionHealthResult,
    PartitionIntensityLevel,
    PartitionTile,
    ProvisioningState,
    RecommendationImpact,
    RecommendationItem,
    RecommendationsResult,
    RuTrendPoint,
    RuTrendsResult,
    TimeRange,
    UnavailableReason,
} from '../../panels/accountOverview/services';
export type {
    MetricAggregation,
    MetricKey,
    MetricPoint,
    MetricSeriesResult,
    MetricUnit,
} from '../../panels/accountOverview/metrics/contracts';
export type { InventoryContainerRow, ThroughputMode } from '../../panels/trpc/routers/accountOverviewRouter';
export type { QueryEditorEvent } from '../../panels/trpc/routers/queryEditorEventsRouter';
