/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { describe, expect, it, vi } from 'vitest';
import { dims, iso, mockClient, throwingClient, type Series } from '../services/testFixtures';
import { getAccountMetricApplicability, getMetricApplicability, METRIC_KEYS } from './contracts';
import { fetchMetricSeries } from './hostFetchers';
import { summarizeStorage, unavailableStorage } from './storage';

// ─── Host metric fetcher registry ───────────────────────────────────────────────
//
// Covers the generic fetcher's cross-metric behaviour: combining multiple Azure
// Monitor series (max for parallel latency modes, sum for data + index storage),
// dropping the container filter for account-only metrics, flooring the interval to
// a metric's coarsest grain, and carrying the empty-state reason through.

type Field = 'average' | 'maximum' | 'total';
type Options = { metricnames?: string; filter?: string; interval?: string; aggregation?: string };

/** Builds a single-series Azure Monitor response reading the given aggregation field. */
function resp(field: Field, points: [number, number][]): { value: { timeseries: Series[] }[] } {
    return {
        value: [{ timeseries: [{ data: points.map(([ts, v]) => ({ timeStamp: iso(ts), [field]: v })) }] }],
    };
}

/** A MonitorClient that records every `metrics.list` option and dispatches on the metric name. */
function recordingClient(
    responses: Record<string, { value: { timeseries: Series[] }[] }>,
    calls: Options[],
): MonitorClient {
    return {
        metrics: {
            list: (_resourceUri: string, options: Options) => {
                calls.push(options);
                return Promise.resolve(responses[options.metricnames ?? ''] ?? { value: [] });
            },
        },
    } as unknown as MonitorClient;
}

const T1 = 1_000;
const T2 = 2_000;

describe('metric applicability', () => {
    it('marks only the two provisioned-capacity metrics inapplicable for confirmed Serverless', () => {
        const applicability = getAccountMetricApplicability(true);
        expect(METRIC_KEYS.filter((key) => applicability[key].status === 'notApplicable')).toEqual([
            'normalizedRu',
            'provisionedThroughput',
        ]);
        expect(applicability.normalizedRu).toEqual({ status: 'notApplicable', reason: 'serverlessNormalizedRu' });
        expect(applicability.provisionedThroughput).toEqual({
            status: 'notApplicable',
            reason: 'serverlessProvisionedThroughput',
        });
    });

    it.each(METRIC_KEYS)(
        'keeps %s applicable for Provisioned and unknown when capacity metadata is unavailable',
        (metric) => {
            expect(getMetricApplicability(metric, false)).toEqual({ status: 'applicable' });
            expect(getMetricApplicability(metric, undefined)).toEqual({ status: 'unknown' });
        },
    );

    it.each(['normalizedRu', 'provisionedThroughput'] as const)(
        'never queries Monitor or synthesizes zeroes for serverless %s',
        async (metric) => {
            const calls: Options[] = [];
            const result = await fetchMetricSeries(
                metric,
                recordingClient({}, calls),
                '/account',
                { databaseId: 'db' },
                '7D',
                true,
            );
            expect(calls).toEqual([]);
            expect(result).toMatchObject({
                metric,
                applicability: { status: 'notApplicable' },
                available: false,
                points: [],
                databaseId: 'db',
                timeRange: '7D',
            });
            expect(result.peak).toBeUndefined();
            expect(result.reason).toBeUndefined();
        },
    );

    it.each(['normalizedRu', 'provisionedThroughput'] as const)(
        'distinguishes empty, zero, and failed Provisioned %s observations',
        async (metric) => {
            const empty = await fetchMetricSeries(metric, mockClient({}), '/account', {}, '1H', false);
            expect(empty).toMatchObject({
                applicability: { status: 'applicable' },
                available: false,
                reason: 'noData',
            });
            const zero = await fetchMetricSeries(
                metric,
                mockClient({
                    NormalizedRUConsumption: resp('maximum', [[T1, 0]]),
                    ProvisionedThroughput: resp('maximum', [[T1, 0]]),
                }),
                '/account',
                {},
                '1H',
                false,
            );
            expect(zero).toMatchObject({ applicability: { status: 'applicable' }, available: true, peak: 0 });
            expect(zero.points[0].value).toBe(0);
            const denied = await fetchMetricSeries(
                metric,
                throwingClient({ statusCode: 403 }),
                '/account',
                {},
                '1H',
                false,
            );
            expect(denied).toMatchObject({ applicability: { status: 'applicable' }, available: false, reason: 'rbac' });
            const failed = await fetchMetricSeries(
                metric,
                throwingClient(new Error('network failure')),
                '/account',
                {},
                '1H',
                false,
            );
            expect(failed).toMatchObject({
                applicability: { status: 'applicable' },
                available: false,
                reason: 'error',
            });
        },
    );

    it('does not infer inapplicability for another empty Serverless metric', async () => {
        const result = await fetchMetricSeries('totalRequestUnits', mockClient({}), '/account', {}, '24H', true);
        expect(result).toMatchObject({ applicability: { status: 'applicable' }, reason: 'noData', available: false });
    });
});

describe('fetchMetricSeries — multi-series combine', () => {
    it('uses Count for the request-volume tile even when Total disagrees', async () => {
        const calls: Options[] = [];
        const client = recordingClient(
            {
                TotalRequests: {
                    value: [
                        {
                            timeseries: [
                                {
                                    data: [{ timeStamp: iso(T1), count: 480, total: 358 }],
                                },
                            ],
                        },
                    ],
                },
            },
            calls,
        );
        const result = await fetchMetricSeries('totalRequests', client, '/sub/acct', {}, '1H');
        expect(result.points.map((point) => point.value)).toEqual([480]);
        expect(
            calls.filter((call) => call.metricnames === 'TotalRequests').every((call) => call.aggregation === 'Count'),
        ).toBe(true);
    });
    it('combines Direct + Gateway server-side latency by taking the worse (max) per bucket', async () => {
        const client = mockClient({
            ServerSideLatencyDirect: resp('average', [
                [T1, 10],
                [T2, 20],
            ]),
            ServerSideLatencyGateway: resp('average', [
                [T1, 15],
                [T2, 5],
            ]),
        });

        const result = await fetchMetricSeries('serverLatency', client, '/sub/acct', {}, '1H');

        expect(result.available).toBe(true);
        expect(result.points.map((p) => p.value)).toEqual([15, 20]);
        expect(result.peak).toBe(20);
    });

    it('sums data + index usage per bucket', async () => {
        const client = mockClient({
            DataUsage: resp('maximum', [
                [T1, 100],
                [T2, 200],
            ]),
            IndexUsage: resp('maximum', [
                [T1, 10],
                [T2, 20],
            ]),
        });

        const result = await fetchMetricSeries('dataIndexUsage', client, '/sub/acct', {}, '24H');

        expect(result.available).toBe(true);
        expect(result.points.map((p) => p.value)).toEqual([110, 220]);
        expect(result.peak).toBe(220);
        expect(result.storage).toEqual({
            data: { status: 'available', bytes: 200, timestamp: T2 },
            index: { status: 'available', bytes: 20, timestamp: T2 },
        });
    });

    it.each(['DataUsage', 'IndexUsage'])('retains the other storage component when %s fails', async (failedMetric) => {
        const client = mockClient({
            DataUsage: resp('maximum', [[T1, 100]]),
            IndexUsage: resp('maximum', [[T1, 10]]),
        });
        const original = client.metrics.list.bind(client.metrics);
        vi.spyOn(client.metrics, 'list').mockImplementation((resource, options) =>
            options?.metricnames === failedMetric
                ? Promise.reject(Object.assign(new Error('Denied'), { statusCode: 403 }))
                : original(resource, options),
        );
        const result = await fetchMetricSeries('dataIndexUsage', client, '/sub/acct', {}, '24H');
        expect(result.available).toBe(true);
        expect(result.points[0].value).toBeUndefined();
        expect(result.peak).toBeUndefined();
        expect(result.storage?.[failedMetric === 'DataUsage' ? 'data' : 'index']).toEqual({
            status: 'unavailable',
            reason: 'rbac',
        });
        expect(result.storage && summarizeStorage(result.storage)).toEqual({
            status: 'partial',
            bytes: failedMetric === 'DataUsage' ? 10 : 100,
        });
    });

    it('keeps disjoint storage buckets partial and inserts gaps missing from both components', async () => {
        const step = 5 * 60 * 1000;
        const client = mockClient({
            DataUsage: resp('maximum', [
                [T1, 0],
                [T1 + step, 100],
                [T1 + step * 3, 300],
            ]),
            IndexUsage: resp('maximum', [
                [T1, 0],
                [T1 + step * 4, 40],
            ]),
        });
        const result = await fetchMetricSeries('dataIndexUsage', client, '/sub/acct', {}, '1H');
        expect(result.points.map((point) => point.timestamp)).toEqual(
            Array.from({ length: 5 }, (_, i) => T1 + step * i),
        );
        expect(result.points.map((point) => point.value)).toEqual([0, undefined, undefined, undefined, undefined]);
        expect(result.points[2].storage).toEqual(unavailableStorage('noData'));
        expect(result.storage).toEqual({
            data: { status: 'unavailable', reason: 'noData' },
            index: { status: 'available', bytes: 40, timestamp: T1 + step * 4 },
        });
    });

    it('keeps independent failure reasons even when neither storage query succeeds', async () => {
        const client = mockClient({});
        vi.spyOn(client.metrics, 'list').mockImplementation((_resource, options) =>
            Promise.reject(
                Object.assign(new Error('Failed'), {
                    statusCode: options?.metricnames === 'DataUsage' ? 403 : 500,
                }),
            ),
        );
        const result = await fetchMetricSeries('dataIndexUsage', client, '/sub/acct', {}, '24H');
        expect(result.available).toBe(false);
        expect(result.points).toEqual([]);
        expect(result.storage).toEqual({
            data: { status: 'unavailable', reason: 'rbac' },
            index: { status: 'unavailable', reason: 'error' },
        });
    });

    it('queries storage components with identical scope, timespan and minimum grain', async () => {
        const client = mockClient({});
        const list = vi.spyOn(client.metrics, 'list');
        await fetchMetricSeries('dataIndexUsage', client, '/sub/acct', { databaseId: "d'b", containerId: 'c' }, '1H');
        const [dataCall, indexCall] = list.mock.calls;
        expect(dataCall[1]).toMatchObject({
            metricnames: 'DataUsage',
            aggregation: 'Maximum',
            interval: 'PT5M',
            filter: "CollectionName eq 'c' and DatabaseName eq 'd''b'",
        });
        expect(indexCall[1]).toEqual({ ...dataCall[1], metricnames: 'IndexUsage' });
    });

    it('reports noData when every combined series is empty', async () => {
        const result = await fetchMetricSeries('serverLatency', mockClient({}), '/sub/acct', {}, '1H');
        expect(result.available).toBe(false);
        expect(result.reason).toBe('noData');
    });

    it('carries a 403 through as rbac', async () => {
        const result = await fetchMetricSeries(
            'serverLatency',
            throwingClient({ statusCode: 403 }),
            '/sub/acct',
            {},
            '1H',
        );
        expect(result.available).toBe(false);
        expect(result.reason).toBe('rbac');
    });
});

describe('fetchMetricSeries — scope and interval', () => {
    it('never scopes an account-only metric to a container and floors its interval', async () => {
        const calls: Options[] = [];
        const client = recordingClient({ ServiceAvailability: resp('average', [[T1, 99.9]]) }, calls);

        const result = await fetchMetricSeries(
            'serviceAvailability',
            client,
            '/sub/acct',
            { databaseId: 'db', containerId: 'c1' },
            '1H',
        );

        expect(result.available).toBe(true);
        expect(calls).toHaveLength(1);
        // Account-only metric: the CollectionName filter is dropped even with a container selected.
        expect(calls[0].filter).toBeUndefined();
        // ServiceAvailability is only emitted at PT1H, so a 1H range is floored up from PT1M.
        expect(calls[0].interval).toBe('PT1H');
    });

    it('scopes a container-dimensioned metric and floors its interval to the metric grain', async () => {
        const calls: Options[] = [];
        const client = recordingClient({ ProvisionedThroughput: resp('maximum', [[T1, 400]]) }, calls);

        await fetchMetricSeries(
            'provisionedThroughput',
            client,
            '/sub/acct',
            { databaseId: 'db', containerId: 'c1' },
            '1H',
        );

        expect(calls[0].filter).toBe("CollectionName eq 'c1' and DatabaseName eq 'db'");
        // ProvisionedThroughput starts at PT5M, so a 1H range (PT1M) is floored up.
        expect(calls[0].interval).toBe('PT5M');
    });

    it('scopes a container-dimensioned metric to a whole database when no container is given', async () => {
        const calls: Options[] = [];
        const client = recordingClient({ ProvisionedThroughput: resp('maximum', [[T1, 400]]) }, calls);

        await fetchMetricSeries('provisionedThroughput', client, '/sub/acct', { databaseId: 'db' }, '1H');

        // Database-level scope (portal parity): filter on DatabaseName only, no CollectionName clause.
        expect(calls[0].filter).toBe("DatabaseName eq 'db'");
    });

    it('leaves a fine-grained metric interval untouched', async () => {
        const calls: Options[] = [];
        const client = recordingClient({ NormalizedRUConsumption: resp('maximum', [[T1, 55]]) }, calls);

        await fetchMetricSeries('normalizedRu', client, '/sub/acct', {}, '1H');

        expect(calls[0].interval).toBe('PT1M');
    });
});

describe('fetchMetricSeries — documentCount', () => {
    /** DocumentCountV2 response split by collection, each with `dims(db, collection)` metadata. */
    function docResp(collections: Record<string, [number, number][]>): { value: { timeseries: Series[] }[] } {
        return {
            value: [
                {
                    timeseries: Object.entries(collections).map(([collection, points]) => ({
                        metadatavalues: dims('db', collection),
                        data: points.map(([ts, v]) => ({ timeStamp: iso(ts), maximum: v })),
                    })),
                },
            ],
        };
    }

    it('sums each collection latest count and stays window-independent', async () => {
        // Collections report at staggered timestamps; the account total must forward-fill, not
        // count only whoever reported in the final bucket.
        const client = mockClient({
            DocumentCountV2: docResp({
                c1: [
                    [T1, 300],
                    [T2, 375],
                ],
                c2: [[T1, 386]],
            }),
        });

        const day = await fetchMetricSeries('documentCount', client, '/sub/acct', {}, '24H');
        const week = await fetchMetricSeries('documentCount', client, '/sub/acct', {}, '7D');

        expect(day.available).toBe(true);
        // Final bucket = c1's latest (375) + c2's forward-filled latest (386) = 761, not just 375.
        expect(day.points.at(-1)?.value).toBe(761);
        // The scalar is identical regardless of the selected range.
        expect(week.points.at(-1)?.value).toBe(day.points.at(-1)?.value);
    });

    it('folds a collection replicated across regions with max, not sum', async () => {
        // Two region series for the same collection carry the same replicated count.
        const client = mockClient({
            DocumentCountV2: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(T1), maximum: 500 }] },
                            { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(T1), maximum: 500 }] },
                        ],
                    },
                ],
            },
        });

        const result = await fetchMetricSeries('documentCount', client, '/sub/acct', {}, '24H');

        expect(result.available).toBe(true);
        expect(result.points.at(-1)?.value).toBe(500);
    });

    it('scopes the document count to a whole database when no container is given', async () => {
        const calls: Options[] = [];
        const client = recordingClient(
            {
                DocumentCountV2: docResp({
                    c1: [[T1, 300]],
                }),
            },
            calls,
        );

        await fetchMetricSeries('documentCount', client, '/sub/acct', { databaseId: 'db' }, '24H');

        // Database scope splits every collection in that database (CollectionName wildcard) and sums.
        expect(calls[0].filter).toBe("DatabaseName eq 'db' and CollectionName eq '*'");
    });
});
