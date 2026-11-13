/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { mockClient, type Series } from '../../testFixtures';
import {
    getAutoscaleUtilization,
    getContainerIdlePeak,
    getContainerIndexingUsage,
    getContainerMergeStoragePeak,
    getContainerPartitionCount,
} from './metrics';

const timestamp = '2026-01-01T00:00:00.000Z';
const readers = [
    { metric: 'TotalRequestUnits', read: getContainerIdlePeak, regionalPeak: 60, emptyPeak: 0 },
    { metric: 'PhysicalPartitionCount', read: getContainerPartitionCount, regionalPeak: 8, emptyPeak: undefined },
    { metric: 'DataUsage', read: getContainerMergeStoragePeak, regionalPeak: 8, emptyPeak: undefined },
];

describe.each(readers)('$metric container evidence', ({ metric, read, regionalPeak, emptyPeak }) => {
    it.each([
        { label: 'missing metric', value: [] },
        { label: 'missing series', value: [{ timeseries: [] }] },
        { label: 'empty series', value: [{ timeseries: [{ data: [] }] }] },
        {
            label: 'invalid samples',
            value: [
                {
                    timeseries: [
                        {
                            data: [
                                { timeStamp: timestamp, total: null, maximum: null },
                                { timeStamp: timestamp, total: NaN, maximum: Infinity },
                                { timeStamp: 'invalid', total: 0, maximum: 0 },
                            ],
                        },
                    ],
                },
            ],
        },
    ])('applies the metric-specific empty policy to $label', async ({ value }) => {
        const client = mockClient({ [metric]: { value } });
        expect(await read(client, 'resource', 'db', 'container')).toBe(emptyPeak);
    });

    it('propagates request failures instead of treating them as empty telemetry', async () => {
        const client = mockClient({});
        const error = new Error('Metric request failed');
        vi.spyOn(client.metrics, 'list').mockRejectedValueOnce(error);
        await expect(read(client, 'resource', 'db', 'container')).rejects.toBe(error);
    });

    describe('diagnostic offer scope and indexing window', () => {
        it('selects independently latest populated storage samples over six hours', async () => {
            const client = mockClient({
                IndexUsage: {
                    value: [
                        {
                            timeseries: [
                                {
                                    data: [
                                        { timeStamp: timestamp, maximum: 30 },
                                        { timeStamp: '2026-01-01T00:05:00.000Z', maximum: 40 },
                                        { timeStamp: '2026-01-01T00:10:00.000Z', maximum: null },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                DataUsage: {
                    value: [
                        {
                            timeseries: [
                                {
                                    data: [
                                        { timeStamp: timestamp, maximum: 100 },
                                        { timeStamp: '2026-01-01T00:10:00.000Z', maximum: 200 },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            });
            const now = Date.parse('2026-01-01T00:15:00.000Z');
            const list = vi.spyOn(client.metrics, 'list');
            expect(await getContainerIndexingUsage(client, 'resource', 'db', 'container', now)).toEqual({
                indexUsageBytes: 40,
                dataUsageBytes: 200,
            });
            expect(list).toHaveBeenCalledWith(
                'resource',
                expect.objectContaining({
                    interval: 'PT5M',
                    timespan: '2025-12-31T18:15:00.000Z/2026-01-01T00:15:00.000Z',
                    filter: "CollectionName eq 'container' and DatabaseName eq 'db'",
                }),
            );
        });

        it('retains missing index telemetry rather than turning it into zero', async () => {
            const client = mockClient({
                IndexUsage: { value: [] },
                DataUsage: { value: [{ timeseries: [{ data: [{ timeStamp: timestamp, maximum: 100 }] }] }] },
            });
            expect(await getContainerIndexingUsage(client, 'resource', 'db', 'container')).toEqual({
                indexUsageBytes: undefined,
                dataUsageBytes: 100,
            });
        });

        it('queries the empty collection dimension for a shared autoscale offer', async () => {
            const client = mockClient({
                AutoscaledRU: {
                    value: [
                        {
                            timeseries: [
                                { data: [{ timeStamp: timestamp, maximum: 200 }] },
                                { data: [{ timeStamp: timestamp, maximum: 200 }] },
                            ],
                        },
                    ],
                },
            });
            const list = vi.spyOn(client.metrics, 'list');
            expect(await getAutoscaleUtilization(client, 'resource', 'db', undefined, 4000)).toEqual({
                peakPercent: 10,
                avgPercent: 10,
                sampleCount: 1,
            });
            expect(list).toHaveBeenCalledWith(
                'resource',
                expect.objectContaining({
                    filter: "CollectionName eq '' and DatabaseName eq 'db' and PhysicalPartitionId eq '*'",
                }),
            );
        });

        it('reads shared idle consumption from authoritative member containers', async () => {
            const client = mockClient({
                TotalRequestUnits: { value: [{ timeseries: [{ data: [{ timeStamp: timestamp, total: 0 }] }] }] },
            });
            const list = vi.spyOn(client.metrics, 'list');
            expect(await getContainerIdlePeak(client, 'resource', 'db', undefined, undefined, ['member'])).toBe(0);
            expect(list).toHaveBeenCalledExactlyOnceWith(
                'resource',
                expect.objectContaining({ filter: "CollectionName eq 'member' and DatabaseName eq 'db'" }),
            );
        });
    });

    it('preserves an observed zero and scopes both escaped identifiers without wildcard dimensions', async () => {
        const client = mockClient({
            [metric]: { value: [{ timeseries: [{ data: [{ timeStamp: timestamp, total: 0, maximum: 0 }] }] }] },
        });
        const list = vi.spyOn(client.metrics, 'list');

        expect(await read(client, 'resource', "db'one", "container'two")).toBe(0);
        expect(list).toHaveBeenCalledWith(
            'resource',
            expect.objectContaining({
                metricnames: metric,
                filter: "CollectionName eq 'container''two' and DatabaseName eq 'db''one'",
            }),
        );
        expect(list.mock.calls[0][1]?.top).toBeUndefined();
    });

    it('combines regional samples without relying on dimension metadata', async () => {
        const timeseries: Series[] = [
            {
                data: [
                    { timeStamp: timestamp, total: 20, maximum: 4 },
                    { timeStamp: '2026-01-01T00:05:00.000Z', total: 50, maximum: 6 },
                ],
            },
            { data: [{ timeStamp: timestamp, total: 40, maximum: 8 }] },
        ];
        const client = mockClient({ [metric]: { value: [{ timeseries }] } });

        expect(await read(client, 'resource', 'db', 'container')).toBe(regionalPeak);
    });

    it('rejects metric-level failures even when the response contains zero-valued samples', async () => {
        const response = {
            value: [
                {
                    errorCode: 'InternalServerError',
                    errorMessage: 'Incomplete metric response',
                    timeseries: [{ data: [{ timeStamp: timestamp, total: 0, maximum: 0 }] }],
                },
            ],
        };
        const client = mockClient({ [metric]: response });

        await expect(read(client, 'resource', 'db', 'container')).rejects.toThrow('Incomplete metric response');
    });
});
