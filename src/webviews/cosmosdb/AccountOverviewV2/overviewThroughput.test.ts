/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type MetricSeriesResult } from '../../api/types';
import { metricSamples } from './overviewMetricsModel';
import { formatRateDelta, summarizeThroughput } from './overviewThroughputModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

type AnalyticsData = NonNullable<OverviewAnalyticsState['data']>;
const context = { timeRange: '24H' as const, loading: false };
const series = (overrides: Partial<MetricSeriesResult> = {}): MetricSeriesResult => ({
    metric: 'normalizedRu',
    available: true,
    timeRange: '24H',
    generatedAt: 900_000,
    peak: 999,
    points: [
        { timestamp: 600_000, value: 81 },
        { timestamp: 0, value: 100 },
        { timestamp: 300_000, value: 90 },
    ],
    ...overrides,
});
const data = (overrides: Partial<AnalyticsData> = {}): AnalyticsData => ({
    timeRange: '24H',
    generatedAt: 86_400_000,
    windowStart: 0,
    windowEnd: 86_400_000,
    previousWindowStart: -86_400_000,
    previousWindowEnd: 0,
    throttling: { available: true, totalRequests: 1000, throttledRequests: 18, ratePercent: 1.8 },
    previousThrottling: { available: true, totalRequests: 1000, throttledRequests: 12, ratePercent: 1.2 },
    consumedRu: { available: true, peakBucketAverageRuPerSecond: 3240, bucketSeconds: 300 },
    autoscaleMaxThroughput: { available: true, value: 10000, timestamp: 600_000 },
    resources: {},
    resourcesComplete: true,
    ...overrides,
});
const analytics = (overrides: Partial<AnalyticsData> = {}): OverviewAnalyticsState => ({
    loading: false,
    failed: false,
    data: data(overrides),
});

describe('throughput measurements', () => {
    it('separates latest usable normalized RU from the period peak and ignores cached peak metadata', () => {
        const result = summarizeThroughput(series(), undefined, analytics(), context);
        expect(result.normalized.value).toBe(81);
        expect(result.normalized.label).toBe('Latest reported normalized RU');
        expect(result.normalizedTimestamp).toBe(600_000);
        expect(result.peak.value).toBe(100);
    });

    it('retains gaps, rejects invalid percentages and timestamps, and reports partial coverage', () => {
        const partial = series({
            points: [
                { timestamp: 0, value: 100 },
                { timestamp: 300_000, value: 81 },
                { timestamp: 400_000, value: undefined },
                { timestamp: 600_000, value: 101 },
                { timestamp: 700_000, value: -1 },
                { timestamp: 800_000, value: Number.NaN },
                { timestamp: Number.NaN, value: 95 },
                { timestamp: Number.MAX_VALUE, value: 95 },
            ],
        });
        const result = summarizeThroughput(partial, undefined, undefined, context);
        expect(result.normalized).toMatchObject({ state: 'partial', value: 81 });
        expect(result.normalizedTimestamp).toBe(300_000);
        expect(result.peak.value).toBe(100);
        expect(metricSamples(partial, true).map((point) => point.value)).toEqual([
            100,
            81,
            undefined,
            undefined,
            undefined,
            undefined,
        ]);
    });

    it('does not substitute cached peak or zero when no normalized samples are usable', () => {
        const result = summarizeThroughput(
            series({ points: [{ timestamp: 0, value: undefined }] }),
            undefined,
            undefined,
            context,
        );
        expect(result.normalized).toMatchObject({ state: 'unavailable', value: undefined });
        expect(result.peak.value).toBeUndefined();
        expect(result.normalizedTimestamp).toBeUndefined();
    });

    it('retains a genuinely measured zero', () => {
        const result = summarizeThroughput(
            series({ points: [{ timestamp: 0, value: 0 }] }),
            undefined,
            analytics(),
            context,
        );
        expect(result.normalized.value).toBe(0);
        expect(result.peak.value).toBe(0);
    });

    it.each([
        [1.2, 0.6, '+0.6 pp'],
        [2.4, -0.6, '−0.6 pp'],
        [1.8, 0, '0 pp'],
    ])('compares a prior rate of %s using percentage points', (prior, expected, label) => {
        const result = summarizeThroughput(
            undefined,
            undefined,
            analytics({
                previousThrottling: {
                    available: true,
                    totalRequests: 1000,
                    throttledRequests: prior * 10,
                    ratePercent: prior,
                },
            }),
            context,
        );
        expect(result.delta).toBeCloseTo(expected);
        expect(formatRateDelta(result.delta!)).toBe(label);
    });

    it('does not round a small nonzero delta to a measured zero', () => {
        expect(formatRateDelta(0.000001)).toBe('+<0.00001 pp');
        expect(formatRateDelta(-0.000001)).toBe('−<0.00001 pp');
    });

    it.each([
        {},
        { available: false, ratePercent: 0, totalRequests: 10, throttledRequests: 0 },
        { available: true, ratePercent: 0, totalRequests: 0, throttledRequests: 0 },
        { available: true, ratePercent: Number.NaN, totalRequests: 10, throttledRequests: 0 },
        { available: true, ratePercent: 101, totalRequests: 10, throttledRequests: 0 },
        { available: true, ratePercent: 2, totalRequests: Number.POSITIVE_INFINITY, throttledRequests: 1 },
        { available: true, ratePercent: 2, totalRequests: 10, throttledRequests: -1 },
        { available: true, ratePercent: 2, totalRequests: 10, throttledRequests: 11 },
    ])('omits the delta when previous requests are missing or invalid: %j', (previous) => {
        const result = summarizeThroughput(
            undefined,
            undefined,
            analytics({
                previousThrottling: { available: false, ...previous },
            }),
            context,
        );
        expect(result.delta).toBeUndefined();
    });

    it.each([
        { previousWindowStart: undefined },
        { previousWindowEnd: undefined },
        { previousWindowStart: Number.NEGATIVE_INFINITY },
        { previousWindowStart: -43_200_000 },
        { previousWindowEnd: -1 },
        { windowStart: 86_400_000 },
        { windowEnd: Number.POSITIVE_INFINITY },
    ])('omits comparisons across invalid or nonadjacent windows: %j', (overrides) => {
        expect(summarizeThroughput(undefined, undefined, analytics(overrides), context).delta).toBeUndefined();
    });

    it('reads provisioned and autoscale latest reported maxima independently', () => {
        const result = summarizeThroughput(
            undefined,
            series({
                metric: 'provisionedThroughput',
                points: [
                    { timestamp: 0, value: 12000 },
                    { timestamp: 600_000, value: 4000 },
                ],
            }),
            analytics(),
            context,
        );
        expect(result.provisioned.value).toBe(4000);
        expect(result.provisionedTimestamp).toBe(600_000);
        expect(result.autoscale.value).toBe(10000);
        expect(result.autoscaleTimestamp).toBe(600_000);
        expect(result.consumed.value).toBe(3240);
    });

    it.each([
        undefined,
        { available: false, value: 10000, timestamp: 600_000 },
        { available: true, value: Number.POSITIVE_INFINITY, timestamp: 600_000 },
        { available: true, value: -1, timestamp: 600_000 },
        { available: true, value: 10000 },
        { available: true, value: 10000, timestamp: -1 },
        { available: true, value: 10000, timestamp: 86_400_000 },
    ])('keeps missing or invalid autoscale maximum unknown: %j', (maximum) => {
        const result = summarizeThroughput(
            undefined,
            undefined,
            analytics({ autoscaleMaxThroughput: maximum }),
            context,
        );
        expect(result.autoscale).toMatchObject({ state: 'unavailable', value: undefined });
        expect(result.autoscaleTimestamp).toBeUndefined();
    });

    it.each([
        { scope: { databaseId: 'new' } },
        { scope: { databaseId: 'new', containerId: 'container' } },
        { timeRange: '7D' as const },
    ])('suppresses snapshots and comparisons after a scope or window change: %j', (change) => {
        const result = summarizeThroughput(series(), series({ metric: 'provisionedThroughput' }), analytics(), {
            ...context,
            ...change,
        });
        expect(result.normalized).toMatchObject({ state: 'stale', value: undefined });
        for (const summary of [result.provisioned, result.throttling, result.consumed]) {
            expect(summary.state).toBe('stale');
            expect(summary.value).toBeUndefined();
        }
        expect(result.autoscale).toMatchObject({ state: 'stale', value: undefined });
        expect(result.delta).toBeUndefined();
    });

    it('suppresses old snapshots while loading and after an analytics failure', () => {
        const result = summarizeThroughput(
            series(),
            series({ metric: 'provisionedThroughput' }),
            {
                ...analytics(),
                loading: true,
            },
            { ...context, loading: true },
        );
        for (const summary of [
            result.normalized,
            result.provisioned,
            result.throttling,
            result.consumed,
            result.autoscale,
        ]) {
            expect(summary.state).toBe('loading');
            expect(summary.value).toBeUndefined();
        }
        expect(result.delta).toBeUndefined();
        const failed = summarizeThroughput(undefined, undefined, { ...analytics(), failed: true }, context);
        expect(failed.autoscale).toMatchObject({ state: 'unavailable', value: undefined });
        expect(failed.delta).toBeUndefined();
    });

    it('makes capacity maxima not applicable to serverless without suppressing consumed RU', () => {
        const result = summarizeThroughput(undefined, series({ metric: 'provisionedThroughput' }), analytics(), {
            ...context,
            serverless: true,
        });
        expect(result.consumed.value).toBe(3240);
        for (const summary of [result.provisioned, result.autoscale]) {
            expect(summary.value).toBeUndefined();
            expect(summary.detail).toContain('Not applicable');
        }
    });
});
