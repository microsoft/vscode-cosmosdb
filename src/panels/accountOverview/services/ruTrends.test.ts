/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MonitorClient, type Response as MetricsResponse, type TimeSeriesElement } from '@azure/arm-monitor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuTrends, getThrottleRate } from './ruTrends';
import { MINUTE } from './shared';
import { dims } from './testFixtures';

const now = Date.parse('2026-11-13T12:00:00Z');
const timestamps = Array.from({ length: 6 }, (_, index) => now - (6 - index) * MINUTE);
const members = ['interactive', 'batch'];

function series(collection: string, value: number, status?: string): TimeSeriesElement {
    return {
        metadatavalues: dims('db', collection, status),
        data: timestamps.map((timeStamp) => ({
            timeStamp: new Date(timeStamp),
            ...(status === undefined ? { maximum: value } : { count: value }),
        })),
    };
}

function setup(batchThrottles: number) {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const ru = [series('', 40), series('interactive', 90), series('batch', 80), series('dedicated', 99)];
    const requests = [
        series('interactive', 50, '200'),
        series('interactive', 50, '429'),
        series('batch', 10000 - batchThrottles, '200'),
        series('batch', batchThrottles, '429'),
        series('dedicated', 100000, '200'),
        series('dedicated', 900000, '429'),
    ];
    const client = new MonitorClient({ getToken: async () => null }, 'sub');
    const list = vi
        .spyOn(client.metrics, 'list')
        .mockImplementation(async (_resource, options): Promise<MetricsResponse> => {
            const metric = options?.metricnames;
            if (metric !== 'NormalizedRUConsumption' && metric !== 'TotalRequests') {
                throw new Error('Unexpected shared-offer metric request.');
            }
            const filters = [
                ...(options?.filter ?? '').matchAll(/(DatabaseName|CollectionName|StatusCode) eq '((?:''|[^'])*)'/g),
            ];
            const selected = (metric === 'NormalizedRUConsumption' ? ru : requests).filter((entry) =>
                filters.every(
                    ([, dimension, literal]) =>
                        literal === '*' ||
                        entry.metadatavalues?.some(
                            (metadata) =>
                                metadata.name?.value === dimension && metadata.value === literal.replace(/''/g, "'"),
                        ),
                ),
            );
            return {
                timespan: '',
                value: [
                    {
                        id: 'metric',
                        name: { value: metric },
                        type: 'Microsoft.Insights/metrics',
                        unit: metric === 'NormalizedRUConsumption' ? 'Percent' : 'Count',
                        timeseries: selected,
                    },
                ],
            };
        });
    return { client, list };
}

afterEach(() => vi.restoreAllMocks());

describe('shared-offer RU and request readers', () => {
    it.each([
        { batchThrottles: 0, throttled: false, throttlesPerBucket: 50 },
        { batchThrottles: 100, throttled: true, throttlesPerBucket: 150 },
    ])(
        'uses combined member counts, not per-member percentages (batch throttles=$batchThrottles)',
        async ({ batchThrottles, throttled, throttlesPerBucket }) => {
            const { client, list } = setup(batchThrottles);
            const trends = await getRuTrends(client, '/account', '1H', 'db', undefined, undefined, members);
            const rate = await getThrottleRate(client, '/account', '1H', 'db', undefined, undefined, members);

            expect(trends.available).toBe(true);
            expect(trends.peakPercent).toBe(40);
            expect(trends.points).toEqual(timestamps.map((timestamp) => ({ timestamp, ruPercent: 40, throttled })));
            expect(rate.totalRequests).toBe(6 * 10100);
            expect(rate.ratePercent).toBeCloseTo((100 * throttlesPerBucket) / 10100, 10);
            expect(
                list.mock.calls
                    .filter(([, options]) => options?.metricnames === 'NormalizedRUConsumption')
                    .map(([, options]) => ({ filter: options?.filter, aggregation: options?.aggregation })),
            ).toEqual([{ filter: "CollectionName eq '' and DatabaseName eq 'db'", aggregation: 'Maximum' }]);
            const requestFilters = members.map(
                (member) => `CollectionName eq '${member}' and DatabaseName eq 'db' and StatusCode eq '*'`,
            );
            expect(
                list.mock.calls
                    .filter(([, options]) => options?.metricnames === 'TotalRequests')
                    .map(([, options]) => ({ filter: options?.filter, aggregation: options?.aggregation })),
            ).toEqual([...requestFilters, ...requestFilters].map((filter) => ({ filter, aggregation: 'Count' })));
        },
    );

    it('does not query request metrics for empty shared membership', async () => {
        const { client, list } = setup(100);
        const trends = await getRuTrends(client, '/account', '1H', 'db', undefined, undefined, []);
        const rate = await getThrottleRate(client, '/account', '1H', 'db', undefined, undefined, []);
        expect(trends.points).toEqual(timestamps.map((timestamp) => ({ timestamp, ruPercent: 40, throttled: false })));
        expect(rate).toEqual({ ratePercent: 0, totalRequests: 0 });
        expect(list).toHaveBeenCalledOnce();
        expect(list.mock.calls[0][1]).toMatchObject({
            metricnames: 'NormalizedRUConsumption',
            filter: "CollectionName eq '' and DatabaseName eq 'db'",
        });
    });
});
