/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MonitorClient } from '@azure/arm-monitor';
import { expect, it, vi } from 'vitest';
import { dims } from '../../testFixtures';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { getIndexingBatch, indexingGroups } from './indexingBatch';

const now = Date.UTC(2026, 0, 1, 12);
const { windowMs, bucketMs, interval } = DIAGNOSTIC_POLICY.indexing.observation;
const start = now - windowMs;
const timespan = `${new Date(start).toISOString()}/${new Date(now).toISOString()}`;

function series(container: string, value: number, complete = true, database = 'db') {
    return {
        metadatavalues: dims(database, container),
        data: Array.from({ length: windowMs / bucketMs - (complete ? 0 : 1) }, (_, index) => ({
            timeStamp: new Date(start + index * bucketMs),
            maximum: value,
        })),
    };
}

it('projects only complete per-member series and preserves a measured zero', async () => {
    const monitor = new MonitorClient({ getToken: async () => null }, 'sub');
    const list = vi.spyOn(monitor.metrics, 'list').mockResolvedValue({
        timespan,
        interval,
        value: [
            {
                id: 'index',
                type: 'Microsoft.Insights/metrics',
                name: { value: 'IndexUsage' },
                unit: 'Bytes',
                timeseries: [series("quoted'id", 0), series('other', 20, false)],
            },
            {
                id: 'data',
                type: 'Microsoft.Insights/metrics',
                name: { value: 'DataUsage' },
                unit: 'Bytes',
                timeseries: [series("quoted'id", 100), series('other', 200), series('other', 1, true, 'elsewhere')],
            },
        ],
    });

    expect(await getIndexingBatch(monitor, 'account', 'db', ["quoted'id", 'other'], now)).toEqual(
        new Map([["quoted'id", { IndexUsage: 0 }]]),
    );
    expect(list).toHaveBeenCalledExactlyOnceWith(
        'account',
        expect.objectContaining({
            metricnames: 'IndexUsage,DataUsage',
            filter: "DatabaseName eq 'db' and (CollectionName eq 'quoted''id' or CollectionName eq 'other')",
            top: 5,
        }),
    );
});

it('never joins identities across databases and bounds each group', () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ databaseId: 'db', containerId: `c${index}` }));
    expect(indexingGroups([...rows, { databaseId: 'db2', containerId: 'c0' }]).map((group) => group.length)).toEqual([
        50, 1, 1,
    ]);
});
