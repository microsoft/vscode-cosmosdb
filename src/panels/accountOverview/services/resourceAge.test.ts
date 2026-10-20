/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MonitorClient, type EventData } from '@azure/arm-monitor';
import { describe, expect, it, vi } from 'vitest';
import { getContainerCreatedAt, getKnownResourceAgeDays, getSystemCreatedAt } from './resourceAge';
import { pagedItems } from './testFixtures';
import { DAY } from './units';

function clientWithEvents(events: EventData[]) {
    const client = new MonitorClient({ getToken: async () => null }, 'sub');
    const list = vi.spyOn(client.activityLogs, 'list').mockImplementation(() => pagedItems(events));
    return { client, list };
}

describe('known resource age', () => {
    it('uses only creation metadata, never the mutable resource timestamp', () => {
        expect(getSystemCreatedAt({ resource: { _ts: 123 } })).toBeUndefined();
        expect(getSystemCreatedAt({ systemData: { createdAt: new Date('invalid') } })).toBeUndefined();
        expect(getSystemCreatedAt({ systemData: { createdAt: new Date(0) } })).toBe(new Date(0).toISOString());
        expect(getKnownResourceAgeDays(undefined, new Date(0), 7 * DAY)).toBe(7);
        expect(getKnownResourceAgeDays(undefined, undefined, 7 * DAY)).toBeUndefined();
    });

    it('resolves a young container on an older account from the earliest retained write event', async () => {
        const now = Date.UTC(2026, 0, 10);
        const { client, list } = clientWithEvents([
            {
                operationName: { value: 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/read' },
                eventTimestamp: new Date(0),
            },
            {
                operationName: { value: 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/write' },
                eventTimestamp: new Date(now - DAY),
            },
            {
                operationName: { value: 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/write' },
                eventTimestamp: new Date(now - 2 * DAY),
            },
        ]);
        const created = await getContainerCreatedAt(client, '/account', "db'quoted", 'container', now);
        expect(getKnownResourceAgeDays(created, new Date(0), now)).toBe(2);
        expect(list).toHaveBeenCalledWith(
            expect.stringContaining("resourceId eq '/account/sqlDatabases/db''quoted/containers/container'"),
        );
    });

    it('keeps absent creation events unknown and propagates denied queries', async () => {
        const { client } = clientWithEvents([]);
        expect(await getContainerCreatedAt(client, '/account', 'db', 'container')).toBeUndefined();
        vi.spyOn(client.activityLogs, 'list').mockImplementation(() => {
            throw new Error('denied');
        });
        await expect(getContainerCreatedAt(client, '/account', 'db', 'container')).rejects.toThrow('denied');
    });
});
