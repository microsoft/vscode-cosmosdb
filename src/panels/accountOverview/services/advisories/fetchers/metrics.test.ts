/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { mockClient, type Series } from '../../testFixtures';
import { getContainerIdlePeak, getContainerMergeStoragePeak, getContainerPartitionCount } from './metrics';

const timestamp = '2026-01-01T00:00:00.000Z';
const readers = [
    { metric: 'TotalRequestUnits', read: getContainerIdlePeak, regionalPeak: 60 },
    { metric: 'PhysicalPartitionCount', read: getContainerPartitionCount, regionalPeak: 8 },
    { metric: 'DataUsage', read: getContainerMergeStoragePeak, regionalPeak: 8 },
];

describe.each(readers)('$metric container evidence', ({ metric, read, regionalPeak }) => {
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
    ])('keeps $label unknown instead of returning zero', async ({ value }) => {
        const client = mockClient({ [metric]: { value } });
        expect(await read(client, 'resource', 'db', 'container')).toBeUndefined();
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
