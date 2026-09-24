/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type ContainerMetrics, type MetricSeriesResult, type PartitionHealthResult } from '../../api/types';
import {
    formatByteChange,
    formatSummaryValue,
    rankResourceConsumers,
    rankResourcePeaks,
    summarizeMetric,
    summarizeOverviewAnalytics,
    summarizePartition,
} from './overviewMetricsModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const context = { timeRange: '24H' as const, loading: false };
const series = (overrides: Partial<MetricSeriesResult> = {}): MetricSeriesResult => ({
    metric: 'normalizedRu',
    available: true,
    points: [
        { timestamp: 1, value: 20 },
        { timestamp: 2, value: 80 },
    ],
    peak: 80,
    timeRange: '24H',
    generatedAt: 3,
    ...overrides,
});
const row = (containerId: string, peakRuPercent?: number): ContainerMetrics => ({
    databaseId: 'database',
    containerId,
    peakRuPercent,
    throttled: false,
    health: 'Healthy',
});
const partition = (): PartitionHealthResult & { timeRange: '24H' } => ({
    available: true,
    databaseId: 'database',
    containerId: 'container',
    timeRange: '24H',
    mode: 'ru',
    tiles: [{ partitionId: '0', sharePercent: 95, level: 5, hot: true }],
    skewScore: 99,
    topPartitionShare: 95,
    maxSaturationPercent: 95,
    minSaturationPercent: 50,
    hotPartition: true,
    partitionCount: 1,
    topN: 5,
    generatedAt: 3,
});
const partitionContext = {
    container: { databaseId: 'database', containerId: 'container' },
    mode: 'ru' as const,
    ...context,
};
type AnalyticsData = NonNullable<OverviewAnalyticsState['data']>;
const consumer = (containerId: string, peakBucketAverageRuPerSecond?: number): AnalyticsData['resources'][string] => ({
    databaseId: 'database',
    containerId,
    consumedRu: {
        available: peakBucketAverageRuPerSecond !== undefined,
        peakBucketAverageRuPerSecond,
        bucketSeconds: 300,
    },
    throttling: { available: true, ratePercent: 2, totalRequests: 100, throttledRequests: 2 },
});
const analytics = (overrides: Partial<AnalyticsData> = {}): OverviewAnalyticsState => ({
    loading: false,
    failed: false,
    data: {
        timeRange: '24H',
        generatedAt: 86_400_000,
        windowStart: 0,
        windowEnd: 86_400_000,
        consumedRu: { available: true, peakBucketAverageRuPerSecond: 100, bucketSeconds: 300 },
        throttling: { available: true, ratePercent: 2, totalRequests: 100, throttledRequests: 2 },
        resourcesComplete: true,
        resources: { 'database/a': consumer('a', 100) },
        ...overrides,
    },
});

describe('overview metric statistics', () => {
    it('validates the scope and window of the compact throughput cards', () => {
        expect(summarizeOverviewAnalytics(analytics(), context)).toMatchObject({
            throttling: { state: 'ready', value: 2 },
            consumed: { state: 'ready', value: 100, unit: 'RU/s' },
        });
        for (const data of [{ timeRange: '7D' as const }, { databaseId: 'different' }, { containerId: 'different' }]) {
            const result = summarizeOverviewAnalytics(analytics(data), context);
            expect(result.throttling).toMatchObject({ state: 'stale' });
            expect(result.consumed.value).toBeUndefined();
        }
        expect(summarizeOverviewAnalytics(analytics({ windowStart: 5, windowEnd: 4 }), context).throttling.state).toBe(
            'unavailable',
        );
    });

    it('never renders no-traffic rates, invalid buckets or stale loading values as measurements', () => {
        expect(
            summarizeOverviewAnalytics(
                analytics({
                    throttling: { available: true, ratePercent: 0, totalRequests: 0, throttledRequests: 0 },
                    consumedRu: { available: true, peakBucketAverageRuPerSecond: 100, bucketSeconds: 0 },
                }),
                context,
            ),
        ).toMatchObject({
            throttling: { state: 'unavailable', value: undefined },
            consumed: { state: 'unavailable', value: undefined },
        });
        expect(summarizeOverviewAnalytics({ ...analytics(), loading: true }, context).throttling).toMatchObject({
            state: 'loading',
        });
        expect(summarizeOverviewAnalytics({ ...analytics(), failed: true }, context).consumed.state).toBe(
            'unavailable',
        );
        expect(
            summarizeOverviewAnalytics(
                analytics({
                    throttling: { available: true, ratePercent: 0, totalRequests: 10, throttledRequests: 0 },
                    consumedRu: { available: true, peakBucketAverageRuPerSecond: 0, bucketSeconds: 300 },
                }),
                context,
            ),
        ).toMatchObject({
            throttling: { state: 'ready', value: 0 },
            consumed: { state: 'ready', value: 0 },
        });
    });

    it('labels the maximum normalized RU as a period peak rather than consumption or an average', () => {
        expect(summarizeMetric('normalizedRu', series(), context)).toMatchObject({
            value: 80,
            unit: '%',
            label: 'Period peak normalized RU',
            state: 'ready',
        });
    });

    it('uses total consumed RU, never relabeling bucket totals as RU/s', () => {
        expect(summarizeMetric('totalRequestUnits', series({ metric: 'totalRequestUnits' }), context)).toMatchObject({
            value: 100,
            unit: 'RU',
            label: 'Consumed RU in reported intervals',
        });
        expect(
            summarizeMetric('provisionedThroughput', series({ metric: 'provisionedThroughput' }), context),
        ).toMatchObject({
            value: 80,
            unit: 'RU/s',
        });
    });

    it('labels latency as the peak interval average, not P99', () => {
        const result = summarizeMetric('serverLatency', series({ metric: 'serverLatency' }), context);
        expect(result).toMatchObject({ value: 80, unit: 'ms', label: 'Peak interval-average server latency' });
        expect(result.label).not.toContain('P99');
    });

    it('takes latest availability by timestamp rather than peak or array position', () => {
        const result = summarizeMetric(
            'serviceAvailability',
            series({
                metric: 'serviceAvailability',
                peak: 100,
                points: [
                    { timestamp: 3, value: 97 },
                    { timestamp: 1, value: 100 },
                ],
            }),
            context,
        );
        expect(result.value).toBe(97);
    });

    it('does not display a prior scope or range while loading or after mismatched responses', () => {
        expect(summarizeMetric('normalizedRu', series(), { ...context, loading: true })).toMatchObject({
            state: 'loading',
        });
        expect(summarizeMetric('normalizedRu', series(), { ...context, loading: true }).value).toBeUndefined();
        expect(summarizeMetric('normalizedRu', series({ timeRange: '7D' }), context).state).toBe('stale');
        expect(summarizeMetric('normalizedRu', series({ databaseId: 'old' }), context).state).toBe('stale');
        expect(summarizeMetric('normalizedRu', series(), { ...context, scope: { databaseId: 'new' } }).state).toBe(
            'stale',
        );
    });

    it('distinguishes missing data and failed requests from measured zero', () => {
        expect(summarizeMetric('normalizedRu', undefined, context).value).toBeUndefined();
        expect(summarizeMetric('normalizedRu', series({ points: [], peak: 0 }), context).value).toBeUndefined();
        expect(summarizeMetric('normalizedRu', series({ available: false, reason: 'rbac' }), context).detail).toContain(
            'permission',
        );
        expect(
            summarizeMetric('normalizedRu', series({ points: [{ timestamp: 1, value: 0 }], peak: 0 }), context).value,
        ).toBe(0);
    });

    it('marks partially usable samples and rejects NaN, Infinity, invalid timestamps and impossible percentages', () => {
        const result = summarizeMetric(
            'normalizedRu',
            series({
                points: [
                    { timestamp: 1, value: 40 },
                    { timestamp: 2, value: NaN },
                    { timestamp: 3, value: Infinity },
                    { timestamp: NaN, value: 20 },
                    { timestamp: 5, value: undefined },
                    { timestamp: 6, value: 101 },
                ],
            }),
            context,
        );
        expect(result).toMatchObject({ value: 40, state: 'partial' });
        expect(result.detail).toContain('1 of 6');
    });

    it('does not overflow a sum or render invalid values as numbers', () => {
        const result = summarizeMetric(
            'totalRequestUnits',
            series({
                metric: 'totalRequestUnits',
                points: [
                    { timestamp: 1, value: Number.MAX_VALUE },
                    { timestamp: 2, value: Number.MAX_VALUE },
                ],
            }),
            context,
        );
        expect(result.state).toBe('unavailable');
        expect(formatSummaryValue({ value: NaN, unit: '%' })).toBe('—');
        expect(formatSummaryValue({ value: 1024 ** 3, unit: 'bytes' })).toBe('1 GiB');
        expect(formatSummaryValue({ value: 80, unit: 'RU/s' })).toBe('80 RU/s');
    });

    it('preserves percentage precision without turning near-perfect availability or tiny rates into endpoints', () => {
        expect(formatSummaryValue({ value: 99.999, unit: '%' })).toBe('99.999%');
        expect(formatSummaryValue({ value: 0.00012, unit: '%' })).toBe('0.00012%');
        expect(formatSummaryValue({ value: 0.000001, unit: '%' })).toBe('<0.00001%');
        expect(formatSummaryValue({ value: 99.999999, unit: '%' })).toBe('>99.99999%');
        expect(formatSummaryValue({ value: 0, unit: '%' })).toBe('0%');
        expect(formatSummaryValue({ value: 100, unit: '%' })).toBe('100%');
    });
});

describe('resource and partition snapshots', () => {
    it('ranks valid normalized RU peaks, preserves ties deterministically, and reports partial rows', () => {
        const result = rankResourcePeaks(
            {
                available: true,
                generatedAt: 1,
                accountHealth: 'Healthy',
                timeRange: '24H',
                metrics: {
                    a: row('a', 90),
                    z: row('z', 90),
                    idle: row('idle', 0),
                    missing: row('missing'),
                    invalid: row('invalid', NaN),
                },
            },
            '24H',
        );
        expect(result.rows.map((item) => item.containerId)).toEqual(['a', 'z', 'idle']);
        expect(result.state).toBe('partial');
    });

    describe('scoped consumed-RU resource ranking', () => {
        it('sorts measured bucket-average consumption descending with deterministic resource ties', () => {
            const state = analytics({
                resources: {
                    'database/z': consumer('z', 100),
                    'database/low': consumer('low', 1),
                    'database/a': consumer('a', 100),
                },
            });
            const result = rankResourceConsumers(state, context);
            expect(result.state).toBe('ready');
            expect(result.rows.map((item) => item.containerId)).toEqual(['a', 'z', 'low']);
            expect(Object.keys(state.data!.resources)[0]).toBe('database/z');
            expect(result.rows[0]).toMatchObject({
                peakBucketAverageRuPerSecond: 100,
                bucketSeconds: 300,
                ratePercent: 2,
            });
        });

        it('excludes missing, invalid and unavailable consumption but retains an explicitly measured zero', () => {
            const result = rankResourceConsumers(
                analytics({
                    resources: {
                        zero: consumer('zero', 0),
                        missing: consumer('missing'),
                        nan: consumer('nan', NaN),
                        negative: consumer('negative', -1),
                        unavailable: {
                            ...consumer('unavailable', 50),
                            consumedRu: { available: false, peakBucketAverageRuPerSecond: 50, bucketSeconds: 300 },
                        },
                    },
                }),
                context,
            );
            expect(result.rows.map((item) => item.containerId)).toEqual(['zero']);
            expect(result.state).toBe('partial');
            expect(result.detail).toContain('1 of 5');
        });

        it('retains available rows while explaining incomplete split coverage and its reason', () => {
            const result = rankResourceConsumers(
                analytics({ resourcesComplete: false, resourcesReason: 'rbac' }),
                context,
            );
            expect(result.state).toBe('partial');
            expect(result.rows).toHaveLength(1);
            expect(result.detail).toContain('Incomplete resource-split coverage');
            expect(result.detail).toContain('permission');
        });

        it('suppresses loading, failed and mismatched scope/window snapshots', () => {
            expect(rankResourceConsumers({ ...analytics(), loading: true }, context)).toMatchObject({
                state: 'loading',
                rows: [],
            });
            expect(rankResourceConsumers({ ...analytics(), failed: true }, context)).toMatchObject({
                state: 'unavailable',
                rows: [],
            });
            expect(rankResourceConsumers(analytics({ databaseId: 'database' }), context).state).toBe('stale');
            expect(rankResourceConsumers(analytics({ timeRange: '7D' }), context).state).toBe('stale');
            expect(rankResourceConsumers(analytics(), { ...context, scope: { databaseId: 'database' } }).state).toBe(
                'stale',
            );
            expect(rankResourceConsumers(analytics({ windowEnd: NaN }), context).state).toBe('unavailable');
        });

        it('does not leak out-of-scope resource rows even if returned by a split query', () => {
            const result = rankResourceConsumers(
                analytics({
                    databaseId: 'database',
                    resources: {
                        a: consumer('a', 1),
                        other: { ...consumer('other', 100), databaseId: 'other-database' },
                    },
                }),
                { ...context, scope: { databaseId: 'database' } },
            );
            expect(result.rows.map((item) => item.containerId)).toEqual(['a']);
            expect(result.state).toBe('partial');
        });

        it('enriches only identical resource identities from matching available inventory windows', () => {
            const metadata = { ...row('a', 90), storageBytes: 1024, indexGrowthBytes: -256 };
            const inventory = {
                available: true,
                accountHealth: 'Healthy' as const,
                generatedAt: 1,
                timeRange: '24H' as const,
                metrics: { 'database/a': metadata },
            };
            expect(rankResourceConsumers(analytics(), context, inventory).rows[0].inventory).toEqual(metadata);
            expect(
                rankResourceConsumers(analytics(), context, { ...inventory, timeRange: '7D' }).rows[0].inventory,
            ).toBeUndefined();
            expect(
                rankResourceConsumers(analytics(), context, { ...inventory, available: false }).rows[0].inventory,
            ).toBeUndefined();
            expect(
                rankResourceConsumers(analytics(), context, {
                    ...inventory,
                    metrics: {
                        'database/a': { ...metadata, containerId: 'wrong' },
                    },
                }).rows[0].inventory,
            ).toBeUndefined();
        });

        it('joins Azure casing to canonical inventory, exposes Large as unavailable, and rejects the aggregate', () => {
            const identities = [
                ['bugbash', 'order'],
                ['bugbash', 'products'],
                ['bugbash', 'test'],
                ['Test', 'Large'],
                ['Test', 'Test'],
            ].map(([databaseId, containerId]) => ({ databaseId, containerId }));
            const result = rankResourceConsumers(
                analytics({
                    resources: Object.fromEntries(
                        [
                            { ...consumer('<empty>', 0.3), databaseId: '<empty>' },
                            { ...consumer('order', 0.1), databaseId: 'bugbash' },
                            { ...consumer('products', 0.08), databaseId: 'bugbash' },
                            { ...consumer('test', 0.06), databaseId: 'bugbash' },
                            { ...consumer('test', 0.05), databaseId: 'test' },
                        ].map((resource) => [`${resource.databaseId}/${resource.containerId}`, resource]),
                    ),
                }),
                context,
                {
                    available: true,
                    timeRange: '24H',
                    accountHealth: 'Healthy',
                    generatedAt: 1,
                    metrics: { 'test/test': { ...row('test', 90), databaseId: 'test', storageBytes: 100 } },
                },
                { available: true, rows: identities },
            );
            expect(result.rows.map((resource) => `${resource.databaseId}/${resource.containerId}`)).toEqual([
                'bugbash/order',
                'bugbash/products',
                'bugbash/test',
                'Test/Test',
                'Test/Large',
            ]);
            expect(result.rows[3].inventory).toMatchObject({
                databaseId: 'Test',
                containerId: 'Test',
                storageBytes: 100,
            });
            expect(result.rows[4].peakBucketAverageRuPerSecond).toBeUndefined();
            expect(result.rows[4].ratePercent).toBeUndefined();
            expect(result.state).toBe('partial');
            expect(result.detail).toContain('4 of 5');
        });

        it('does not let an aggregate consume a top-five slot when all five containers are measured', () => {
            const resources = [
                { ...consumer('<empty>', 100), databaseId: '<empty>' },
                ...['one', 'two', 'three', 'four', 'Large'].map((id, index) => consumer(id, 5 - index)),
            ];
            const result = rankResourceConsumers(
                analytics({ resources: Object.fromEntries(resources.map((resource, index) => [index, resource])) }),
                context,
                undefined,
                { available: true, rows: resources.slice(1) },
            );
            expect(result.rows.slice(0, 5).map((resource) => resource.containerId)).toEqual([
                'one',
                'two',
                'three',
                'four',
                'Large',
            ]);
            expect(result.rows[4].peakBucketAverageRuPerSecond).toBe(1);
            expect(result.state).toBe('partial');
        });

        it('does not attribute deleted resources or ambiguous case-folded identities to current inventory', () => {
            const result = rankResourceConsumers(
                analytics({
                    resources: {
                        a: { ...consumer('test', 50), databaseId: 'test' },
                        deleted: consumer('deleted', 100),
                    },
                }),
                context,
                undefined,
                {
                    available: true,
                    rows: [
                        { databaseId: 'Test', containerId: 'Test' },
                        { databaseId: 'test', containerId: 'test' },
                    ],
                },
            );
            expect(result.rows).toHaveLength(2);
            expect(result.rows.every((resource) => resource.peakBucketAverageRuPerSecond === undefined)).toBe(true);
            expect(result.state).toBe('unavailable');
            expect(result.detail).toContain('0 of 2');
        });

        it('withholds duplicate casing variants rather than adding or choosing per-resource peaks', () => {
            const result = rankResourceConsumers(
                analytics({
                    resources: {
                        lower: { ...consumer('test', 10), databaseId: 'test' },
                        upper: { ...consumer('Test', 20), databaseId: 'Test' },
                    },
                }),
                context,
                undefined,
                { available: true, rows: [{ databaseId: 'Test', containerId: 'Test' }] },
            );
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].peakBucketAverageRuPerSecond).toBeUndefined();
            expect(result.state).toBe('unavailable');
        });

        it('matches canonical casing before scope filtering and never adds out-of-scope inventory', () => {
            const result = rankResourceConsumers(
                analytics({
                    databaseId: 'Test',
                    containerId: 'Test',
                    resources: { measured: { ...consumer('test', 1), databaseId: 'test' } },
                }),
                { ...context, scope: { databaseId: 'Test', containerId: 'Test' } },
                undefined,
                {
                    available: true,
                    rows: [
                        { databaseId: 'Test', containerId: 'Test' },
                        { databaseId: 'Test', containerId: 'Large' },
                    ],
                },
            );
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0]).toMatchObject({
                databaseId: 'Test',
                containerId: 'Test',
                peakBucketAverageRuPerSecond: 1,
            });
            expect(result.state).toBe('ready');
        });

        it('keeps inventory-only rows unavailable and does not construct actions from failed inventory', () => {
            const identities = [{ databaseId: 'Test', containerId: 'Large' }];
            const emptyResult = rankResourceConsumers(analytics({ resources: {} }), context, undefined, {
                available: true,
                rows: identities,
            });
            expect(emptyResult.rows).toHaveLength(1);
            expect(emptyResult.rows[0].peakBucketAverageRuPerSecond).toBeUndefined();
            expect(emptyResult.rows[0].ratePercent).toBeUndefined();
            expect(emptyResult.state).toBe('unavailable');
            expect(
                rankResourceConsumers(analytics(), context, undefined, { available: false, rows: identities }),
            ).toMatchObject({ state: 'unavailable', rows: [] });
        });

        it('distinguishes no-request and missing 429 rates from a measured zero rate', () => {
            const state = analytics({
                resources: {
                    idle: {
                        ...consumer('idle', 0),
                        throttling: { available: false, totalRequests: 0, throttledRequests: 0 },
                    },
                    zero: {
                        ...consumer('zero', 10),
                        throttling: { available: true, ratePercent: 0, totalRequests: 100, throttledRequests: 0 },
                    },
                    missing: { ...consumer('missing', 5), throttling: { available: false, reason: 'rbac' } },
                },
            });
            const rows = rankResourceConsumers(state, context).rows;
            expect(rows.find((item) => item.containerId === 'zero')?.ratePercent).toBe(0);
            expect(rows.find((item) => item.containerId === 'idle')).toMatchObject({
                ratePercent: undefined,
                throttlingDetail: 'No measured requests; a 429 rate is undefined.',
            });
            expect(rows.find((item) => item.containerId === 'missing')?.ratePercent).toBeUndefined();
        });

        it('formats signed seven-day changes as bytes rather than percentages', () => {
            expect(formatByteChange(-1024)).toBe('−1 KiB');
            expect(formatByteChange(1024)).toBe('+1 KiB');
            expect(formatByteChange(0)).toBe('0 B');
            expect(formatByteChange(NaN)).toBe('—');
        });
    });

    it('suppresses peaks when their measurement window is missing or stale', () => {
        const snapshot = {
            available: true,
            generatedAt: 1,
            accountHealth: 'Healthy' as const,
            metrics: { a: row('a', 90) },
        };
        expect(rankResourcePeaks(snapshot, '24H')).toMatchObject({ state: 'stale', rows: [] });
        expect(rankResourcePeaks({ ...snapshot, timeRange: '7D' }, '24H')).toMatchObject({ state: 'stale', rows: [] });
    });

    it('does not mistake physical partition saturation for a share of consumed RU', () => {
        const result = summarizePartition(partition(), partitionContext);
        expect(result.value).toBe(95);
        expect(result.label).toBe('Busiest partition p99 normalized RU');
        expect(result.detail).toContain('not a share of consumed RU');
    });

    it('does not use a stale container, mode, window, missing selection or loading partition', () => {
        expect(summarizePartition(partition(), { ...partitionContext, container: undefined }).value).toBeUndefined();
        expect(summarizePartition(partition(), { ...partitionContext, loading: true }).value).toBeUndefined();
        expect(summarizePartition({ ...partition(), containerId: 'other' }, partitionContext).state).toBe('stale');
        expect(summarizePartition({ ...partition(), mode: 'storage' }, partitionContext).state).toBe('stale');
        expect(summarizePartition({ ...partition(), timeRange: '7D' }, partitionContext).state).toBe('stale');
    });

    it('rejects missing or invalid saturation rather than falling back to skew score', () => {
        expect(
            summarizePartition({ ...partition(), maxSaturationPercent: undefined }, partitionContext).value,
        ).toBeUndefined();
        expect(summarizePartition({ ...partition(), maxSaturationPercent: NaN }, partitionContext).state).toBe(
            'unavailable',
        );
        expect(
            summarizePartition({ ...partition(), available: false, reason: 'unsupported' }, partitionContext).detail,
        ).toContain('API');
    });
});
