/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient, type TimeSeriesElement } from '@azure/arm-monitor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankResourceConsumers } from '../../../webviews/cosmosdb/AccountOverviewV2/overviewMetricsModel';
import { getInventoryResult } from './inventory';
import {
    aggregateConsumedRu,
    aggregateThrottling,
    getOverviewAnalytics,
    unavailableOverviewAnalytics,
} from './overviewAnalytics';
import { type TimeRange } from './shared';
import { dims } from './testFixtures';

function series(
    status: string | undefined,
    values: number[],
    database = 'db',
    container = 'container',
    start = '2026-09-08T11:00:00Z',
): TimeSeriesElement {
    return {
        metadatavalues: dims(database, container, status),
        data: values.map((total, index) => ({
            timeStamp: new Date(Date.parse(start) + index * 60000),
            total,
        })),
    } as TimeSeriesElement;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:30.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('overview analytics aggregation', () => {
    it('divides total 429 requests by total requests, not the average bucket rate', () => {
        expect(aggregateThrottling([series('200', [90, 990]), series('429', [10, 10])])).toMatchObject({
            available: true,
            totalRequests: 1100,
            throttledRequests: 20,
            ratePercent: (20 / 1100) * 100,
        });
    });

    it('distinguishes measured zero throttling from idle and missing request samples', () => {
        expect(aggregateThrottling([series('200', [100])])).toMatchObject({ available: true, ratePercent: 0 });
        expect(aggregateThrottling([series('200', [0])])).toMatchObject({
            available: false,
            totalRequests: 0,
            ratePercent: undefined,
        });
        expect(aggregateThrottling([])).toEqual({ available: false, reason: 'noData' });
        expect(aggregateThrottling([series(undefined, [100])])).toEqual({ available: false, reason: 'noData' });
    });

    it.each([60, 300, 3600])(
        'converts RU bucket totals to peak bucket-average RU/s with %i-second buckets',
        (seconds) => {
            expect(
                aggregateConsumedRu(
                    new Map([
                        [0, seconds * 20],
                        [seconds * 1000, seconds * 5],
                    ]),
                    seconds,
                ),
            ).toMatchObject({ available: true, peakBucketAverageRuPerSecond: 20, bucketSeconds: seconds });
        },
    );

    it('distinguishes zero consumed RU from missing or invalid samples', () => {
        expect(aggregateConsumedRu(new Map([[0, 0]]), 60).peakBucketAverageRuPerSecond).toBe(0);
        expect(
            aggregateConsumedRu(
                new Map([
                    [0, Number.NaN],
                    [1, -1],
                ]),
                60,
            ).available,
        ).toBe(false);
        expect(aggregateConsumedRu(new Map(), 60).available).toBe(false);
    });
});

describe('overview analytics fetching', () => {
    it('does not expose Azure empty dimensions as a container or discard the measured account total', async () => {
        const list = vi.fn().mockImplementation((_id, options) =>
            Promise.resolve({
                value: [
                    {
                        timeseries: options.filter?.includes("DatabaseName eq '*'")
                            ? [
                                  series('200', [18], '<empty>', '<empty>'),
                                  series('200', [6], 'bugbash', 'order'),
                                  series('200', [5], 'bugbash', 'products'),
                                  series('200', [4], 'bugbash', 'test'),
                                  series('200', [3], 'test', 'test'),
                              ]
                            : [series('200', [36], '', '')],
                    },
                ],
            }),
        );
        const result = await getOverviewAnalytics(
            { metrics: { list } } as unknown as MonitorClient,
            '/account',
            {},
            '1H',
        );
        expect(Object.keys(result.resources)).toEqual([
            'bugbash/order',
            'bugbash/products',
            'bugbash/test',
            'test/test',
        ]);
        expect(result.consumedRu.peakBucketAverageRuPerSecond).toBe(0.6);
        expect(result.resourcesComplete).toBe(false);

        const inventory = await getInventoryResult(
            {
                sqlResources: {
                    listSqlDatabases: async function* () {
                        yield { resource: { id: 'bugbash' } };
                        yield { resource: { id: 'Test' } };
                    },
                    listSqlContainers: async function* (_group: string, _account: string, database: string) {
                        for (const id of database === 'Test' ? ['Large', 'Test'] : ['order', 'products', 'test']) {
                            yield { resource: { id } };
                        }
                    },
                },
            } as unknown as CosmosDBManagementClient,
            'group',
            'account',
            true,
        );
        const ranking = rankResourceConsumers(
            { data: result, loading: false, failed: false },
            { timeRange: '1H' },
            undefined,
            inventory,
        );
        expect(inventory.rows.map((row) => `${row.databaseId}/${row.containerId}`)).toEqual([
            'bugbash/order',
            'bugbash/products',
            'bugbash/test',
            'Test/Large',
            'Test/Test',
        ]);
        expect(ranking.rows.slice(0, 5).map((row) => `${row.databaseId}/${row.containerId}`)).toEqual([
            'bugbash/order',
            'bugbash/products',
            'bugbash/test',
            'Test/Test',
            'Test/Large',
        ]);
        expect(ranking.rows[4].peakBucketAverageRuPerSecond).toBeUndefined();
        expect(ranking.rows[3].peakBucketAverageRuPerSecond).toBe(0.05);
        expect(ranking.state).toBe('partial');
    });

    it.each([
        ['', 'container'],
        ['db', ''],
        ['<empty>', 'container'],
        ['db', '<empty>'],
        [' ', 'container'],
    ])(
        'withholds unnamed split identity %j / %j without withholding named measurements',
        async (database, container) => {
            const list = vi.fn().mockResolvedValue({
                value: [{ timeseries: [series('200', [18], database, container), series('200', [6], 'db', 'real')] }],
            });
            const result = await getOverviewAnalytics(
                { metrics: { list } } as unknown as MonitorClient,
                '/account',
                {},
                '1H',
            );
            expect(Object.keys(result.resources)).toEqual(['db/real']);
            expect(result.resources['db/real'].consumedRu.peakBucketAverageRuPerSecond).toBe(0.1);
            expect(result.resourcesComplete).toBe(false);
            expect(result.consumedRu.peakBucketAverageRuPerSecond).toBe(0.4);
            expect(result.throttling.totalRequests).toBe(24);
        },
    );

    it('uses one closed-bucket window, escaped scope, correct Total aggregation and independent headline queries', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-08T12:00:30.000Z'));
        const list = vi.fn().mockImplementation((_id, options) =>
            Promise.resolve({
                value: [
                    {
                        timeseries:
                            options.metricnames === 'TotalRequests'
                                ? [series('200', [90]), series('429', [10])]
                                : [series(undefined, [600])],
                    },
                ],
            }),
        );
        const result = await getOverviewAnalytics(
            { metrics: { list } } as unknown as MonitorClient,
            '/account',
            { databaseId: "my'db", containerId: "my'container" },
            '1H',
        );
        expect(list).toHaveBeenCalledTimes(6);
        for (const [id, options] of list.mock.calls.slice(0, 4)) {
            expect(id).toBe('/account');
            expect(options.aggregation).toBe('Total');
            expect(options.timespan).toBe('2026-09-08T11:00:00.000Z/2026-09-08T12:00:00.000Z');
            expect(options.filter).toContain("DatabaseName eq 'my''db'");
            expect(options.filter).toContain("CollectionName eq 'my''container'");
        }
        expect(result.throttling.ratePercent).toBe(10);
        expect(result.consumedRu.peakBucketAverageRuPerSecond).toBe(10);
        expect(result.resources['db/container'].consumedRu.peakBucketAverageRuPerSecond).toBe(10);
    });

    describe('throughput health analytics', () => {
        const previousStart = '2026-09-08T10:00:00Z';
        const fetch = (list: ReturnType<typeof vi.fn>) =>
            getOverviewAnalytics({ metrics: { list } } as unknown as MonitorClient, '/account', {}, '1H');
        const isPrevious = (timespan: string) => timespan.startsWith('2026-09-08T10:00:00.000Z/');

        it('provides weighted previous rates for a percentage-point comparison', async () => {
            const list = vi.fn().mockImplementation((_id, options) => ({
                value: [
                    {
                        timeseries: isPrevious(options.timespan)
                            ? [
                                  series('200', [90, 990], undefined, undefined, previousStart),
                                  series('429', [10, 10], undefined, undefined, previousStart),
                              ]
                            : [series('200', [90]), series('429', [10])],
                    },
                ],
            }));
            const result = await fetch(list);
            expect(result.previousThrottling).toMatchObject({
                available: true,
                totalRequests: 1100,
                throttledRequests: 20,
                ratePercent: (100 * 20) / 1100,
            });
            expect(result.throttling.ratePercent! - result.previousThrottling!.ratePercent!).toBeCloseTo(8.181818);
        });

        it.each([{ values: [] }, { values: [0] }])(
            'withholds a previous rate without measured requests: $values',
            async ({ values }) => {
                const list = vi.fn().mockImplementation((_id, options) => ({
                    value: [
                        {
                            timeseries: isPrevious(options.timespan)
                                ? [series('200', values, undefined, undefined, previousStart)]
                                : [series('200', [100])],
                        },
                    ],
                }));
                const result = await fetch(list);
                expect(result.previousThrottling).toMatchObject({ available: false, reason: 'noData' });
                expect(result.previousThrottling?.ratePercent).toBeUndefined();
                expect(result.previousThrottling?.totalRequests).toBe(values.length ? 0 : undefined);
                expect(result.throttling.ratePercent).toBe(0);
            },
        );

        it.each([
            ['previous', 403, 'rbac'],
            ['previous', 500, 'noData'],
            ['autoscale', 403, 'rbac'],
            ['autoscale', 500, 'noData'],
        ])('isolates %s failures (%i) from valid current data', async (metric, statusCode, reason) => {
            const list = vi.fn().mockImplementation((_id, options) => {
                if (
                    (metric === 'previous' && isPrevious(options.timespan)) ||
                    (metric === 'autoscale' && options.metricnames === 'AutoscaleMaxThroughput')
                ) {
                    return Promise.reject(Object.assign(new Error('Query failed'), { statusCode }));
                }
                if (options.metricnames === 'AutoscaleMaxThroughput') {
                    return {
                        value: [
                            {
                                timeseries: [
                                    {
                                        data: [{ timeStamp: new Date('2026-09-08T11:55:00Z'), maximum: 4000 }],
                                    },
                                ],
                            },
                        ],
                    };
                }
                return {
                    value: [
                        {
                            timeseries: [
                                series(
                                    '200',
                                    [600],
                                    undefined,
                                    undefined,
                                    isPrevious(options.timespan) ? previousStart : undefined,
                                ),
                            ],
                        },
                    ],
                };
            });
            const result = await fetch(list);
            expect(metric === 'previous' ? result.previousThrottling : result.autoscaleMaxThroughput).toEqual({
                available: false,
                reason,
            });
            expect(result.throttling.ratePercent).toBe(0);
            expect(result.consumedRu.peakBucketAverageRuPerSecond).toBe(10);
            expect(result.resourcesComplete).toBe(true);
            expect(result.resources['db/container'].throttling.available).toBe(true);
            expect(result.previousThrottling?.ratePercent).toBe(metric === 'autoscale' ? 0 : undefined);
            expect(result.autoscaleMaxThroughput?.available).toBe(metric === 'previous');
        });

        it('withholds a capped previous split without withholding the current measurements', async () => {
            const list = vi.fn().mockImplementation((_id, options) => ({
                value: [
                    {
                        timeseries: isPrevious(options.timespan)
                            ? Array.from({ length: 10000 }, () =>
                                  series('200', [600], undefined, undefined, previousStart),
                              )
                            : [series('200', [600])],
                    },
                ],
            }));
            const result = await fetch(list);
            expect(result.previousThrottling).toEqual({ available: false, reason: 'noData' });
            expect(result.throttling.available).toBe(true);
            expect(result.consumedRu.available).toBe(true);
            expect(result.resourcesComplete).toBe(true);
        });

        it('includes only complete samples inside the exact previous endpoints', async () => {
            const sample = series('200', []);
            sample.data = [
                { timeStamp: new Date('2026-09-08T09:59:00Z'), total: 1000 },
                { timeStamp: new Date(previousStart), total: 2 },
                { timeStamp: new Date('2026-09-08T10:59:00Z'), total: 3 },
                { timeStamp: new Date('2026-09-08T10:59:30Z'), total: 1000 },
                { timeStamp: new Date('2026-09-08T11:00:00Z'), total: 1000 },
                { timeStamp: new Date(Number.NaN), total: 1000 },
            ];
            const list = vi.fn().mockResolvedValue({ value: [{ timeseries: [sample] }] });
            expect((await fetch(list)).previousThrottling).toMatchObject({
                available: true,
                totalRequests: 5,
                ratePercent: 0,
            });
        });

        it.each([
            [
                '1H',
                '2026-09-08T10:03:00.000Z',
                '2026-09-08T11:03:00.000Z',
                'PT1M',
                '2026-09-08T11:05:00.000Z/2026-09-08T12:00:00.000Z',
                'PT5M',
            ],
            [
                '24H',
                '2026-09-06T12:00:00.000Z',
                '2026-09-07T12:00:00.000Z',
                'PT5M',
                '2026-09-07T12:00:00.000Z/2026-09-08T12:00:00.000Z',
                'PT5M',
            ],
            [
                '7D',
                '2026-08-25T12:00:00.000Z',
                '2026-09-01T12:00:00.000Z',
                'PT1H',
                '2026-09-01T12:00:00.000Z/2026-09-08T12:00:00.000Z',
                'PT1H',
            ],
        ])(
            'uses adjacent equal-duration previous windows and supported autoscale buckets for %s',
            async (timeRange, start, end, interval, autoscaleTimespan, autoscaleInterval) => {
                vi.setSystemTime(new Date('2026-09-08T12:03:30Z'));
                for (const scope of [
                    {},
                    { databaseId: "my'db" },
                    { databaseId: "my'db", containerId: "my'container" },
                ]) {
                    const list = vi.fn().mockResolvedValue({ value: [] });
                    const result = await getOverviewAnalytics(
                        { metrics: { list } } as unknown as MonitorClient,
                        '/account',
                        scope,
                        timeRange as TimeRange,
                    );
                    expect(list).toHaveBeenCalledTimes(6);
                    expect(result.previousWindowStart).toBe(Date.parse(start));
                    expect(result.previousWindowEnd).toBe(Date.parse(end));
                    expect(result.previousWindowEnd).toBe(result.windowStart);
                    expect(result.previousWindowEnd! - result.previousWindowStart!).toBe(
                        result.windowEnd - result.windowStart,
                    );
                    const currentOptions = list.mock.calls[0][1];
                    expect(list.mock.calls[4]).toEqual([
                        '/account',
                        { ...currentOptions, timespan: `${start}/${end}` },
                    ]);
                    expect(currentOptions).toMatchObject({
                        metricnames: 'TotalRequests',
                        aggregation: 'Total',
                        interval,
                        top: 10000,
                    });
                    const filter = [
                        ...(scope.containerId ? ["CollectionName eq 'my''container'"] : []),
                        ...(scope.databaseId ? ["DatabaseName eq 'my''db'"] : []),
                    ].join(' and ');
                    expect(currentOptions.filter).toBe(
                        filter ? `${filter} and StatusCode eq '*'` : "StatusCode eq '*'",
                    );
                    expect(list.mock.calls[5]).toEqual([
                        '/account',
                        {
                            metricnames: 'AutoscaleMaxThroughput',
                            aggregation: 'Maximum',
                            timespan: autoscaleTimespan,
                            interval: autoscaleInterval,
                            filter: filter || undefined,
                        },
                    ]);
                }
            },
        );

        it('returns the latest valid reported maximum, not a window peak or a sum across resources', async () => {
            const list = vi.fn().mockResolvedValue({
                value: [
                    {
                        timeseries: [
                            {
                                data: [
                                    { timeStamp: new Date('2026-09-08T11:50:00Z'), maximum: 4000 },
                                    { timeStamp: new Date('2026-09-08T11:05:00Z'), maximum: 9000 },
                                    { timeStamp: new Date('2026-09-08T11:55:00Z'), maximum: Number.NaN },
                                    { timeStamp: new Date('2026-09-08T11:56:00Z'), maximum: Infinity },
                                    { timeStamp: new Date('2026-09-08T11:57:00Z'), maximum: -1 },
                                    { timeStamp: new Date(Number.NaN), maximum: 10000 },
                                ],
                            },
                            { data: [{ timeStamp: new Date('2026-09-08T11:50:00Z'), maximum: 2000 }] },
                        ],
                    },
                ],
            });
            expect((await fetch(list)).autoscaleMaxThroughput).toEqual({
                available: true,
                value: 4000,
                timestamp: Date.parse('2026-09-08T11:50:00Z'),
            });
        });

        it.each([undefined, Number.NaN, Infinity, -1, 0])(
            'distinguishes missing/invalid maxima from measured zero: %s',
            async (maximum) => {
                const list = vi.fn().mockResolvedValue({
                    value: [
                        {
                            timeseries: [
                                { data: [{ timeStamp: new Date('2026-09-08T11:55:00Z'), maximum, total: 9999 }] },
                            ],
                        },
                    ],
                });
                expect((await fetch(list)).autoscaleMaxThroughput).toEqual(
                    maximum === 0
                        ? { available: true, value: 0, timestamp: Date.parse('2026-09-08T11:55:00Z') }
                        : { available: false, reason: 'noData' },
                );
            },
        );

        it.each([{ value: [] }, { value: [{ timeseries: [] }] }])(
            'reports empty autoscale responses as noData: $value',
            async ({ value }) => {
                const list = vi.fn().mockResolvedValue({ value });
                expect((await fetch(list)).autoscaleMaxThroughput).toEqual({ available: false, reason: 'noData' });
            },
        );

        it('excludes autoscale buckets crossing either window boundary and the in-progress bucket', async () => {
            vi.setSystemTime(new Date('2026-09-08T12:03:30Z'));
            const list = vi.fn().mockResolvedValue({
                value: [
                    {
                        timeseries: [
                            {
                                data: [
                                    { timeStamp: new Date('2026-09-08T11:00:00Z'), maximum: 9000 },
                                    { timeStamp: new Date('2026-09-08T11:05:00Z'), maximum: 7000 },
                                    { timeStamp: new Date('2026-09-08T11:55:00Z'), maximum: 4000 },
                                    { timeStamp: new Date('2026-09-08T11:59:00Z'), maximum: 9000 },
                                    { timeStamp: new Date('2026-09-08T12:00:00Z'), maximum: 9000 },
                                    { timeStamp: new Date('2026-09-08T12:05:00Z'), maximum: 9000 },
                                ],
                            },
                        ],
                    },
                ],
            });
            expect((await fetch(list)).autoscaleMaxThroughput).toEqual({
                available: true,
                value: 4000,
                timestamp: Date.parse('2026-09-08T11:55:00Z'),
            });
        });

        it('initializes optional analytics honestly when overview analytics are unavailable', () => {
            const result = unavailableOverviewAnalytics({}, '1H', 'rbac');
            expect(result.previousThrottling).toEqual({ available: false, reason: 'rbac' });
            expect(result.autoscaleMaxThroughput).toEqual({ available: false, reason: 'rbac' });
            expect(result.previousWindowStart).toBe(Date.parse(previousStart));
            expect(result.previousWindowEnd).toBe(result.windowStart);
        });
    });

    it('keeps scoped headline results when resource-split queries lack permissions', async () => {
        const list = vi.fn().mockImplementation((_id, options) => {
            if (options.filter?.includes("DatabaseName eq '*'")) {
                return Promise.reject(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
            }
            return Promise.resolve({ value: [{ timeseries: [series('200', [600])] }] });
        });
        const result = await getOverviewAnalytics(
            { metrics: { list } } as unknown as MonitorClient,
            '/account',
            {},
            '1H',
        );
        expect(result.throttling.ratePercent).toBe(0);
        expect(result.consumedRu.peakBucketAverageRuPerSecond).toBe(10);
        expect(result.resourcesComplete).toBe(false);
        expect(result.resourcesReason).toBe('rbac');
    });

    it('isolates RU unavailability from requests and propagates its specific reason', async () => {
        const list = vi
            .fn()
            .mockImplementation((_id, options) =>
                options.metricnames === 'TotalRequestUnits'
                    ? Promise.reject(Object.assign(new Error('Forbidden'), { statusCode: 403 }))
                    : Promise.resolve({ value: [{ timeseries: [series('200', [600])] }] }),
            );
        const result = await getOverviewAnalytics(
            { metrics: { list } } as unknown as MonitorClient,
            '/account',
            {},
            '24H',
        );
        expect(result.throttling.available).toBe(true);
        expect(result.consumedRu).toEqual({ available: false, reason: 'rbac', bucketSeconds: 300 });
        expect(result.resources['db/container'].consumedRu.reason).toBe('rbac');
    });

    it('does not sum per-resource peaks into a false scoped peak', async () => {
        const list = vi.fn().mockImplementation((_id, options) =>
            Promise.resolve({
                value: [
                    {
                        timeseries: options.filter?.includes("DatabaseName eq '*'")
                            ? [series('200', [600, 0], 'db', 'a'), series('200', [0, 600], 'db', 'b')]
                            : [series('200', [600, 600])],
                    },
                ],
            }),
        );
        const result = await getOverviewAnalytics(
            { metrics: { list } } as unknown as MonitorClient,
            '/account',
            {},
            '1H',
        );
        expect(result.consumedRu.peakBucketAverageRuPerSecond).toBe(10);
        expect(Object.keys(result.resources)).toHaveLength(2);
    });

    it('excludes the in-progress boundary bucket from request percentages and consumed RU/s', async () => {
        const sample = series('200', [600]);
        sample.data?.push({ timeStamp: new Date('2026-09-08T12:00:00Z'), total: 600000 });
        const list = vi.fn().mockResolvedValue({ value: [{ timeseries: [sample] }] });
        const result = await getOverviewAnalytics(
            { metrics: { list } } as unknown as MonitorClient,
            '/account',
            {},
            '1H',
        );
        expect(result.throttling.totalRequests).toBe(600);
        expect(result.consumedRu.peakBucketAverageRuPerSecond).toBe(10);
        expect(result.resources['db/container'].consumedRu.peakBucketAverageRuPerSecond).toBe(10);
    });

    it('withholds resource rates when a split query may have been truncated', async () => {
        const list = vi.fn().mockImplementation((_id, options) =>
            Promise.resolve({
                value: [
                    {
                        timeseries: options.filter?.includes("DatabaseName eq '*'")
                            ? Array.from({ length: 10000 }, () => series('200', [600]))
                            : [series('200', [600])],
                    },
                ],
            }),
        );
        const result = await getOverviewAnalytics(
            { metrics: { list } } as unknown as MonitorClient,
            '/account',
            {},
            '1H',
        );
        expect(result.throttling.available).toBe(true);
        expect(result.resourcesComplete).toBe(false);
        expect(result.resources['db/container'].throttling.available).toBe(false);
        expect(result.resources['db/container'].consumedRu.available).toBe(false);
    });
});
