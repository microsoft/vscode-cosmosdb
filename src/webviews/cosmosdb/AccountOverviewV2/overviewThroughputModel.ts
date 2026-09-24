/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type MetricSeriesResult, type TimeRange } from '../../api/types';
import { type MetricScope } from '../AccountOverview/metrics/descriptors';
import { unavailableSummary } from './overviewFindingsModel';
import {
    isNonNegativeFinite,
    metricSamples,
    type MetricSummary,
    summarizeMetric,
    summarizeOverviewAnalytics,
} from './overviewMetricsModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

export const THROTTLING_GUIDE_PERCENT = 5;
export const NORMALIZED_ATTENTION_PERCENT = 80;
export const hasMeasurement = (summary: MetricSummary) => summary.state === 'ready' || summary.state === 'partial';

export function summarizeThroughput(
    normalizedSeries: MetricSeriesResult | undefined,
    provisionedSeries: MetricSeriesResult | undefined,
    analytics: OverviewAnalyticsState | undefined,
    context: { timeRange: TimeRange; scope?: MetricScope; loading: boolean; serverless?: boolean },
) {
    const peak = summarizeMetric('normalizedRu', normalizedSeries, context);
    const latest =
        hasMeasurement(peak) && normalizedSeries
            ? metricSamples(normalizedSeries, true)
                  .filter((point) => point.value !== undefined)
                  .at(-1)
            : undefined;
    const normalized = {
        ...peak,
        label: l10n.t('Latest reported normalized RU'),
        value: latest?.value,
    };
    const provisioned = summarizeMetric('provisionedThroughput', provisionedSeries, context);
    const provisionedTimestamp =
        hasMeasurement(provisioned) && provisionedSeries
            ? metricSamples(provisionedSeries, false)
                  .filter((point) => point.value !== undefined)
                  .at(-1)?.timestamp
            : undefined;
    const { throttling, consumed, window } = summarizeOverviewAnalytics(analytics, context);
    const data = analytics?.data;
    const previous = data?.previousThrottling;
    const validPreviousWindow =
        window !== undefined &&
        data?.previousWindowStart !== undefined &&
        Number.isFinite(data.previousWindowStart) &&
        !Number.isNaN(new Date(data.previousWindowStart).getTime()) &&
        data.previousWindowEnd === data.windowStart &&
        data.previousWindowEnd - data.previousWindowStart === data.windowEnd - data.windowStart;
    const delta =
        hasMeasurement(throttling) &&
        validPreviousWindow &&
        previous?.available &&
        isNonNegativeFinite(previous.totalRequests) &&
        previous.totalRequests > 0 &&
        isNonNegativeFinite(previous.throttledRequests) &&
        previous.throttledRequests <= previous.totalRequests &&
        isNonNegativeFinite(previous.ratePercent) &&
        previous.ratePercent <= 100
            ? throttling.value! - previous.ratePercent
            : undefined;
    const maximum = data?.autoscaleMaxThroughput;
    const validMaximum =
        window !== undefined &&
        maximum?.available &&
        isNonNegativeFinite(maximum.value) &&
        maximum.timestamp !== undefined &&
        Number.isFinite(maximum.timestamp) &&
        maximum.timestamp >= data!.windowStart &&
        maximum.timestamp < data!.windowEnd;
    const autoscale: MetricSummary = {
        state: validMaximum ? 'ready' : window === undefined ? throttling.state : 'unavailable',
        label: l10n.t('Latest reported autoscale maximum'),
        unit: 'RU/s',
        value: validMaximum ? maximum.value : undefined,
        detail:
            window === undefined
                ? throttling.detail
                : validMaximum
                  ? l10n.t('Latest reported maximum for the selected scope, not a sum of resource allocations.')
                  : unavailableSummary(maximum?.reason),
    };
    if (context.serverless) {
        for (const summary of [provisioned, autoscale]) {
            summary.state = 'unavailable';
            summary.value = undefined;
            summary.detail = l10n.t(
                'Not applicable: serverless accounts do not have provisioned or autoscale throughput.',
            );
        }
    }
    return {
        normalized,
        peak,
        normalizedTimestamp: latest?.timestamp,
        provisioned,
        provisionedTimestamp,
        throttling,
        consumed,
        window,
        delta,
        autoscale,
        autoscaleTimestamp: validMaximum && !context.serverless ? maximum.timestamp : undefined,
    };
}

export function formatRateDelta(delta: number): string {
    const magnitude = Math.abs(delta);
    const value =
        magnitude > 0 && magnitude < 0.00001
            ? `<${(0.00001).toLocaleString(undefined, { maximumFractionDigits: 5 })}`
            : magnitude.toLocaleString(undefined, { maximumFractionDigits: 5 });
    return l10n.t('{sign}{value} pp', { sign: delta > 0 ? '+' : delta < 0 ? '−' : '', value });
}
