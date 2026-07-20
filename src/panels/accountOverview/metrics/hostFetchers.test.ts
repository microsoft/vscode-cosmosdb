/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { describe, expect, it } from 'vitest';
import { dims, iso, mockClient, throwingClient, type Series } from '../services/testFixtures';
import { fetchMetricSeries } from './hostFetchers';

// ─── Host metric fetcher registry ───────────────────────────────────────────────
//
// Covers the generic fetcher's cross-metric behaviour: combining multiple Azure
// Monitor series (max for parallel latency modes, sum for data + index storage),
// dropping the container filter for account-only metrics, flooring the interval to
// a metric's coarsest grain, and carrying the empty-state reason through.

type Field = 'average' | 'maximum' | 'total';
type Options = { metricnames?: string; filter?: string; interval?: string };

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

describe('fetchMetricSeries — multi-series combine', () => {
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
