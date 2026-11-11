/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { mockClient, throwingClient } from '../../testFixtures';
import { getAccountRequestStatusCounts, getThrottledOperationCounts } from './metrics';

const now = Date.parse('2026-11-09T12:00:00.000Z');
const timeStamp = '2026-11-09T11:00:00.000Z';
const series = (dimension: string, value: string, count: number) => ({
    metadatavalues: [{ name: { value: dimension }, value }],
    data: [{ timeStamp, count }],
});

describe('account request metric collection', () => {
    it('reads one account-only seven-day hourly status breakdown and sums regional/bucket counts', async () => {
        const client = mockClient({
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            series('StatusCode', '200', 900),
                            series('statuscode', '200', 100),
                            series('StatusCode', '429', 50),
                            {
                                ...series('StatusCode', '404', 10),
                                data: [
                                    { timeStamp, count: 10 },
                                    { timeStamp: '2026-11-09T10:00:00.000Z', count: 20 },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
        const list = vi.spyOn(client.metrics, 'list');
        expect(await getAccountRequestStatusCounts(client, 'account', now)).toEqual({ 200: 1000, 429: 50, 404: 30 });
        expect(list).toHaveBeenCalledExactlyOnceWith('account', {
            metricnames: 'TotalRequests',
            aggregation: 'Count',
            interval: 'PT1H',
            timespan: '2026-11-02T12:00:00.000Z/2026-11-09T12:00:00.000Z',
            filter: "StatusCode eq '*'",
            top: 1000,
        });
    });

    it('uses the same observation for the 429-only operation split', async () => {
        const client = mockClient({
            TotalRequests: {
                value: [{ timeseries: [series('OperationType', 'Create', 30), series('OperationType', 'Read', 20)] }],
            },
        });
        const list = vi.spyOn(client.metrics, 'list');
        expect(await getThrottledOperationCounts(client, 'account', now)).toEqual({ Create: 30, Read: 20 });
        expect(list).toHaveBeenCalledExactlyOnceWith(
            'account',
            expect.objectContaining({
                filter: "StatusCode eq '429' and OperationType eq '*'",
                timespan: '2026-11-02T12:00:00.000Z/2026-11-09T12:00:00.000Z',
                interval: 'PT1H',
                aggregation: 'Count',
            }),
        );
    });

    it('does not turn absent, malformed or nonpositive samples into measured counts', async () => {
        const client = mockClient({
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            series('StatusCode', '200', -1),
                            series('StatusCode', '404', Infinity),
                            series('StatusCode', '429', NaN),
                            series('StatusCode', '500', 0),
                            series('OperationType', 'Create', 100),
                            {
                                ...series('StatusCode', '403', 10),
                                data: [
                                    { timeStamp: 'invalid', count: 10 },
                                    { timeStamp, total: 10 },
                                ],
                            },
                            { data: [{ timeStamp, count: 1000 }] },
                        ],
                    },
                ],
            },
        });
        expect(await getAccountRequestStatusCounts(client, 'account', now)).toEqual({});
        expect(await getAccountRequestStatusCounts(mockClient({}), 'account', now)).toEqual({});
    });

    it.each([getAccountRequestStatusCounts, getThrottledOperationCounts])(
        'propagates denied and metric-level failures from %s',
        async (read) => {
            await expect(read(throwingClient({ statusCode: 403 }), 'account', now)).rejects.toMatchObject({
                statusCode: 403,
            });
            const response = {
                value: [
                    {
                        errorCode: 'InternalServerError',
                        errorMessage: 'Incomplete response',
                        timeseries: [series('StatusCode', '200', 1000)],
                    },
                ],
            };
            const client = mockClient({ TotalRequests: response });
            await expect(read(client, 'account', now)).rejects.toThrow('Incomplete response');
        },
    );

    it('rejects potentially truncated responses instead of claiming complete totals', async () => {
        const client = mockClient({
            TotalRequests: {
                value: [{ timeseries: Array.from({ length: 1000 }, () => series('OperationType', 'Create', 1)) }],
            },
        });
        await expect(getThrottledOperationCounts(client, 'account', now)).rejects.toThrow('may be truncated');
    });
});
