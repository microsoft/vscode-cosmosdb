/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient, type TimeSeriesElement } from '@azure/arm-monitor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankResourceConsumers } from '../../../webviews/cosmosdb/AccountOverviewV2/overviewMetricsModel';
import { getInventoryResult } from './inventory';
import { aggregateConsumedRu, aggregateThrottling, getOverviewAnalytics } from './overviewAnalytics';
import { dims } from './testFixtures';

function series(
    status: string | undefined,
    values: number[],
    database = 'db',
    container = 'container',
): TimeSeriesElement {
    return {
        metadatavalues: dims(database, container, status),
        data: values.map((total, index) => ({
            timeStamp: new Date(Date.parse('2026-09-08T11:00:00Z') + index * 60000),
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
        expect(list).toHaveBeenCalledTimes(4);
        for (const [id, options] of list.mock.calls) {
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
