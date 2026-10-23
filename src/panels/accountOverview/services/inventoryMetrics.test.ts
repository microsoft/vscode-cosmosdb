/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { summarizeStorage } from '../metrics/storage';
import {
    DEFAULT_HEALTH_THRESHOLDS,
    deriveRowHealth,
    getInventoryMetrics,
    type HealthThresholds,
} from './inventoryMetrics';
import { containerKey } from './shared';
import { dims, GB, iso, mockClient, type Point } from './testFixtures';

const thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS;

describe('deriveRowHealth', () => {
    it('is Healthy when nothing crosses a threshold', () => {
        expect(deriveRowHealth({ peakRuPercent: 10, throttled: false }, thresholds)).toBe('Healthy');
    });

    it('does not infer Healthy from missing metrics', () => {
        expect(deriveRowHealth({ peakRuPercent: undefined, throttled: false }, thresholds)).toBeUndefined();
    });

    it('flips to Needs Attention when peak crosses the warning threshold', () => {
        expect(deriveRowHealth({ peakRuPercent: 80, throttled: false }, thresholds)).toBe('Needs Attention');
    });

    it('flips to Critical when peak crosses the critical threshold', () => {
        expect(deriveRowHealth({ peakRuPercent: 90, throttled: false }, thresholds)).toBe('Critical');
    });

    it('is Critical when throttled regardless of peak', () => {
        expect(deriveRowHealth({ peakRuPercent: 1, throttled: true }, thresholds)).toBe('Critical');
    });

    it('does not use a normalized RU value to assess Serverless', () => {
        expect(deriveRowHealth({ peakRuPercent: 100, throttled: false }, thresholds, true)).toBe('Healthy');
        expect(deriveRowHealth({ peakRuPercent: 100 }, thresholds, true)).toBeUndefined();
        expect(deriveRowHealth({ throttled: true }, thresholds, true)).toBe('Critical');
    });
});

// ─── getInventoryMetrics with a mocked MonitorClient ────────────────────────

describe('getInventoryMetrics', () => {
    const base = Date.now();
    const minute = 60 * 1000;

    it('passes Serverless throttling from request observations without storage or normalized RU', async () => {
        const client = mockClient({
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1', '200'),
                                data: [{ timeStamp: iso(base), count: 20 }],
                            },
                        ],
                    },
                ],
            },
        });
        const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds, undefined, true);
        expect(result.metrics['db/c1']).toMatchObject({ throttled: false, health: 'Healthy' });
        expect(result.metrics['db/c1'].peakRuPercent).toBeUndefined();
    });

    it.each(['rbac', 'error', 'embedded'] as const)(
        'does not report a failed request check as clear (%s)',
        async (failure) => {
            const client = mockClient({
                TotalRequests: { value: [{ timeseries: [] }] },
                DataUsage: {
                    value: [
                        {
                            timeseries: [
                                {
                                    metadatavalues: dims('db', 'c1'),
                                    data: [{ timeStamp: iso(base), maximum: 100 }],
                                },
                            ],
                        },
                    ],
                },
            });
            const original = client.metrics.list.bind(client.metrics);
            vi.spyOn(client.metrics, 'list').mockImplementation((resource, options) =>
                options?.metricnames === 'TotalRequests'
                    ? failure === 'embedded'
                        ? original(resource, options).then((response) => ({
                              ...response,
                              value: (response.value ?? []).map((metric) => ({
                                  ...metric,
                                  errorCode: 'BadRequest',
                                  errorMessage: 'Request query failed',
                              })),
                          }))
                        : Promise.reject(
                              Object.assign(new Error('Request query failed'), {
                                  statusCode: failure === 'rbac' ? 403 : 500,
                              }),
                          )
                    : original(resource, options),
            );
            const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds, undefined, true);
            expect(result.metrics['db/c1'].throttled).toBeUndefined();
            expect(result.metrics['db/c1'].throttlingReason).toBe(failure === 'rbac' ? 'rbac' : 'error');
            expect(result.metrics['db/c1'].health).toBeUndefined();
        },
    );

    it.each([
        { throttled: 10, successful: 10, buckets: 5, gap: false, health: 'Critical' },
        { throttled: 10, successful: 999_990, buckets: 5, gap: false, health: 'Healthy' },
        { throttled: 1, successful: 99, buckets: 5, gap: false, health: 'Healthy' },
        { throttled: 2, successful: 98, buckets: 5, gap: false, health: 'Critical' },
        { throttled: 2, successful: 98, buckets: 4, gap: false, health: 'Healthy' },
        { throttled: 2, successful: 98, buckets: 5, gap: true, health: 'Healthy' },
        { throttled: 0, successful: 0, buckets: 5, gap: false, health: 'Healthy' },
    ])('assesses Serverless share and duration: $throttled/$successful, $buckets buckets, gap $gap', async (input) => {
        const points = (count: number) =>
            Array.from({ length: input.buckets }, (_, index) => ({
                timeStamp: iso(base - (index + (input.gap && index >= 3 ? 1 : 0)) * minute),
                count,
            }));
        const client = mockClient({
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1', '429'), data: points(input.throttled) },
                            { metadatavalues: dims('db', 'c1', '200'), data: points(input.successful) },
                        ],
                    },
                ],
            },
        });
        const result = await getInventoryMetrics(client, '/sub/acct', '7D', thresholds, undefined, true);
        expect(result.metrics['db/c1']).toMatchObject({
            throttled: input.health === 'Critical',
            health: input.health,
        });
        expect(result.metrics['db/c1'].throttlingReason).toBeUndefined();
    });

    it.each([
        { name: 'empty', status: '200', points: [] },
        { name: 'null', status: '200', points: [{ timeStamp: iso(base), count: null }] },
        { name: 'invalid timestamp', status: '200', points: [{ timeStamp: 'invalid', count: 10 }] },
        { name: 'non-finite', status: '200', points: [{ timeStamp: iso(base), count: NaN }] },
        { name: 'negative', status: '200', points: [{ timeStamp: iso(base), count: -1 }] },
        { name: 'missing status', status: undefined, points: [{ timeStamp: iso(base), count: 10 }] },
    ])('keeps Serverless Unknown for $name request observations', async ({ status, points }) => {
        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [{ timeStamp: iso(base), maximum: 100 }],
                            },
                        ],
                    },
                ],
            },
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1', status), data: points },
                            {
                                metadatavalues: dims('db', 'observed', '200'),
                                data: [{ timeStamp: iso(base), count: 10 }],
                            },
                        ],
                    },
                ],
            },
        });
        const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds, undefined, true);
        expect(result.metrics['db/c1'].throttled).toBeUndefined();
        expect(result.metrics['db/c1'].health).toBeUndefined();
        expect(result.metrics['db/c1'].throttlingReason).toBe('noData');
        expect(result.metrics['db/observed']).toMatchObject({ throttled: false, health: 'Healthy' });
    });

    describe.each([
        { missingMetric: 'DataUsage', isServerless: false },
        { missingMetric: 'IndexUsage', isServerless: false },
        { missingMetric: 'DataUsage', isServerless: true },
        { missingMetric: 'IndexUsage', isServerless: true },
    ])('without $missingMetric observations (Serverless: $isServerless)', ({ missingMetric, isServerless }) => {
        it.each([403, 500, 'noData'] as const)('does not publish partial storage as a total (%s)', async (failure) => {
            const observedMetric = missingMetric === 'DataUsage' ? 'IndexUsage' : 'DataUsage';
            const client = mockClient({
                [observedMetric]: {
                    value: [
                        {
                            timeseries: [
                                { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: GB }] },
                            ],
                        },
                    ],
                },
                DocumentCountV2: {
                    value: [
                        {
                            timeseries: [
                                { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: 42 }] },
                            ],
                        },
                    ],
                },
                NormalizedRUConsumption: {
                    value: [
                        {
                            timeseries: [
                                { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: 25 }] },
                            ],
                        },
                    ],
                },
                TotalRequests: {
                    value: [
                        {
                            timeseries: [
                                {
                                    metadatavalues: dims('db', 'c1', '429'),
                                    data: Array.from({ length: 6 }, (_, index) => ({
                                        timeStamp: iso(base - index * minute),
                                        count: 100,
                                    })),
                                },
                            ],
                        },
                    ],
                },
            });
            const original = client.metrics.list.bind(client.metrics);
            vi.spyOn(client.metrics, 'list').mockImplementation((resource, options) => {
                if (options?.metricnames === missingMetric && failure !== 'noData') {
                    return Promise.reject(Object.assign(new Error('Storage query failed'), { statusCode: failure }));
                }
                return original(resource, options);
            });

            const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds, undefined, isServerless);
            const row = result.metrics['db/c1'];
            const missingComponent = missingMetric === 'DataUsage' ? 'data' : 'index';
            const observedComponent = missingMetric === 'DataUsage' ? 'index' : 'data';
            expect(summarizeStorage(row.storage)).toEqual({ status: 'partial', bytes: GB });
            expect(row.storage[missingComponent]).toEqual({
                status: 'unavailable',
                reason: failure === 403 ? 'rbac' : failure === 500 ? 'error' : 'noData',
            });
            expect(row.storage[observedComponent]).toEqual({ status: 'available', bytes: GB, timestamp: base });
            expect(row.documentCount).toBe(42);
            expect(row.peakRuPercent).toBe(isServerless ? undefined : 25);
            expect(row.throttled).toBe(true);
            expect(row.health).toBe('Critical');
            expect(result).not.toHaveProperty('accountHealth');
        });
    });

    it('skips Serverless normalized RU without treating storage observations as health evidence', async () => {
        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: 100 }] },
                        ],
                    },
                ],
            },
        });
        const list = vi.spyOn(client.metrics, 'list');
        const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds, undefined, true);
        expect(result.available).toBe(true);
        expect(result.metrics['db/c1'].storage.data).toEqual({ status: 'available', bytes: 100, timestamp: base });
        expect(summarizeStorage(result.metrics['db/c1'].storage)).toEqual({ status: 'partial', bytes: 100 });
        expect(result.metrics['db/c1'].peakRuPercent).toBeUndefined();
        expect(result.metrics['db/c1'].ruSparkline).toBeUndefined();
        expect(result.metrics['db/c1'].health).toBeUndefined();
        expect(list).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                metricnames: 'NormalizedRUConsumption',
            }),
        );
    });

    it.each([false, true])(
        'retains Serverless 429 health without storage (storage failure: %s)',
        async (failStorage) => {
            const client = mockClient({
                TotalRequests: {
                    value: [
                        {
                            timeseries: [
                                {
                                    metadatavalues: dims('db', 'hot', '429'),
                                    data: Array.from({ length: 6 }, (_, index) => ({
                                        timeStamp: iso(base - index * minute),
                                        count: 100,
                                    })),
                                },
                            ],
                        },
                    ],
                },
            });
            const original = client.metrics.list.bind(client.metrics);
            vi.spyOn(client.metrics, 'list').mockImplementation((resource, options) => {
                if (failStorage && options?.metricnames === 'DataUsage') {
                    return Promise.reject(Object.assign(new Error('Denied'), { statusCode: 403 }));
                }
                return original(resource, options);
            });
            const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds, undefined, true);
            expect(result.metrics['db/hot']).toMatchObject({ throttled: true, health: 'Critical' });
            expect(result.metrics['db/hot'].peakRuPercent).toBeUndefined();
            expect(result.reason).toBe(failStorage ? 'rbac' : undefined);
        },
    );

    it('keeps Serverless health unknown when no telemetry is available', async () => {
        const result = await getInventoryMetrics(mockClient({}), '/sub/acct', '24H', thresholds, undefined, true);
        expect(result).toMatchObject({ available: false, reason: 'noData', metrics: {} });
    });

    it('returns available: false when storage and RU series are both empty', async () => {
        const client = mockClient({});
        const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds);
        expect(result.available).toBe(false);
        expect(result.metrics).toEqual({});
    });

    it('computes storage, growth, peak, and health per container', async () => {
        // c1: DataUsage 100 → 300 (growth 200), Index 50 → storage 350, peak 95 → Critical
        // c2: peak 85 → Needs Attention
        // c3: peak 20, storage growth 12 GB → Healthy (storage growth no longer feeds row health)
        // c4: peak 10, small growth → Healthy
        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [
                                    { timeStamp: iso(base - 6 * minute), maximum: 100 },
                                    { timeStamp: iso(base), maximum: 300 },
                                ],
                            },
                            {
                                metadatavalues: dims('db', 'c3'),
                                data: [
                                    { timeStamp: iso(base - 6 * minute), maximum: 0 },
                                    { timeStamp: iso(base), maximum: 12 * GB },
                                ],
                            },
                            {
                                metadatavalues: dims('db', 'c4'),
                                data: [
                                    { timeStamp: iso(base - 6 * minute), maximum: 10 },
                                    { timeStamp: iso(base), maximum: 20 },
                                ],
                            },
                        ],
                    },
                ],
            },
            IndexUsage: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [{ timeStamp: iso(base), maximum: 50 }],
                            },
                        ],
                    },
                ],
            },
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: 95 }] },
                            { metadatavalues: dims('db', 'c2'), data: [{ timeStamp: iso(base), maximum: 85 }] },
                            { metadatavalues: dims('db', 'c3'), data: [{ timeStamp: iso(base), maximum: 20 }] },
                            { metadatavalues: dims('db', 'c4'), data: [{ timeStamp: iso(base), maximum: 10 }] },
                        ],
                    },
                ],
            },
        });

        const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds);
        expect(result.available).toBe(true);

        const c1 = result.metrics[containerKey('db', 'c1')];
        expect(summarizeStorage(c1.storage)).toEqual({ status: 'complete', bytes: 350 });
        expect(c1.storageGrowthBytes).toBe(200);
        expect(c1.peakRuPercent).toBe(95);
        expect(c1.health).toBe('Critical');

        expect(result.metrics[containerKey('db', 'c2')].health).toBe('Needs Attention');
        expect(result.metrics[containerKey('db', 'c3')].storageGrowthBytes).toBe(12 * GB);
        expect(result.metrics[containerKey('db', 'c3')].health).toBe('Healthy');
        expect(result.metrics[containerKey('db', 'c4')].health).toBe('Healthy');
    });

    it('marks a container Critical and the account Critical on sustained throttling', async () => {
        const throttleData: Point[] = [];
        const okData: Point[] = [];
        for (let i = 0; i < 6; i++) {
            throttleData.push({ timeStamp: iso(base - (5 - i) * minute), count: 100, total: 1 });
            okData.push({ timeStamp: iso(base - (5 - i) * minute), count: 1, total: 100 });
        }

        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'hot'), data: [{ timeStamp: iso(base), maximum: 100 }] },
                        ],
                    },
                ],
            },
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'hot'), data: [{ timeStamp: iso(base), maximum: 30 }] },
                        ],
                    },
                ],
            },
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'hot', '429'), data: throttleData },
                            { metadatavalues: dims('db', 'hot', '200'), data: okData },
                        ],
                    },
                ],
            },
        });

        const result = await getInventoryMetrics(client, '/sub/acct', '1H', thresholds);
        const hot = result.metrics[containerKey('db', 'hot')];
        expect(hot.throttled).toBe(true);
        expect(hot.health).toBe('Critical');
    });

    it('ignores null and invalid Count samples but preserves zero-count buckets for throttling health', async () => {
        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: 0 }] },
                        ],
                    },
                ],
            },
            IndexUsage: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: 0 }] },
                        ],
                    },
                ],
            },
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: 10 }] },
                        ],
                    },
                ],
            },
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1', '429'),
                                data: [
                                    { timeStamp: iso(base - minute), count: null, total: 100 },
                                    { timeStamp: 'bad-timestamp', count: 100, total: 100 },
                                    { timeStamp: iso(base), count: 0, total: 100 },
                                ],
                            },
                            {
                                metadatavalues: dims('db', 'c1', '200'),
                                data: [
                                    { timeStamp: iso(base - minute), count: 1, total: 100 },
                                    { timeStamp: iso(base), count: 0, total: 100 },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getInventoryMetrics(client, '/sub/acct', '1H', thresholds);
        const row = result.metrics[containerKey('db', 'c1')];
        expect(summarizeStorage(row.storage)).toEqual({ status: 'complete', bytes: 0 });
        expect(row.throttled).toBe(false);
        expect(row.health).toBe('Healthy');
    });

    it('surfaces document count and downsampled sparklines per container', async () => {
        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [
                                    { timeStamp: iso(base - 2 * minute), maximum: 100 },
                                    { timeStamp: iso(base - minute), maximum: 200 },
                                    { timeStamp: iso(base), maximum: 300 },
                                ],
                            },
                        ],
                    },
                ],
            },
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [
                                    { timeStamp: iso(base - minute), maximum: 40 },
                                    { timeStamp: iso(base), maximum: 60 },
                                ],
                            },
                        ],
                    },
                ],
            },
            DocumentCountV2: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [
                                    { timeStamp: iso(base - minute), maximum: 1200 },
                                    { timeStamp: iso(base), maximum: 1500 },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getInventoryMetrics(client, '/sub/acct', '24H', thresholds);
        const c1 = result.metrics[containerKey('db', 'c1')];
        expect(c1.documentCount).toBe(1500);
        expect(c1.storageSparkline).toEqual([100, 200, 300]);
        expect(c1.ruSparkline).toEqual([40, 60]);
    });
});
