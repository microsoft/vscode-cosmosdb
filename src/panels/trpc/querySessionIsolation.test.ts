/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { cleanUpSupersededReadSessions, matchesQueryConnection, storeQuerySession } from './querySessionIsolation';

const connection = {
    endpoint: 'https://expected.documents.azure.com/',
    databaseId: 'database',
    containerId: 'container',
};

describe('matchesQueryConnection', () => {
    it('accepts the exact connection that was confirmed', () => {
        expect(matchesQueryConnection(connection, { ...connection })).toBe(true);
    });

    it.each([
        { ...connection, endpoint: 'https://different.documents.azure.com/' },
        { ...connection, databaseId: 'different-database' },
        { ...connection, containerId: 'different-container' },
    ])('rejects connection drift before session creation', (actualConnection) => {
        expect(matchesQueryConnection(actualConnection, connection)).toBe(false);
    });
});

describe('storeQuerySession', () => {
    it('preserves an in-flight session when another tool execution starts in the same tab', () => {
        const existingSession = { id: 'existing', dispose: vi.fn() };
        const newSession = { id: 'new', dispose: vi.fn() };
        const sessions = new Map([[existingSession.id, existingSession]]);

        storeQuerySession(sessions, newSession, true);

        expect(existingSession.dispose).not.toHaveBeenCalled();
        expect([...sessions.keys()]).toEqual(['existing', 'new']);
    });

    describe('cleanUpSupersededReadSessions', () => {
        it('retains the active result for pagination and disposes previously-read superseded sessions', () => {
            const supersededSession = { id: 'superseded', dispose: vi.fn() };
            const activeSession = { id: 'active', dispose: vi.fn() };
            const sessions = new Map([
                [supersededSession.id, supersededSession],
                [activeSession.id, activeSession],
            ]);
            const readSessionIds = new Set([supersededSession.id, activeSession.id]);

            cleanUpSupersededReadSessions(sessions, readSessionIds);

            expect(supersededSession.dispose).toHaveBeenCalledOnce();
            expect(activeSession.dispose).not.toHaveBeenCalled();
            expect([...sessions.keys()]).toEqual(['active']);
            expect([...readSessionIds]).toEqual(['active']);
        });
    });

    it('retains normal editor behavior by replacing old sessions for non-tool executions', () => {
        const existingSession = { id: 'existing', dispose: vi.fn() };
        const newSession = { id: 'new', dispose: vi.fn() };
        const sessions = new Map([[existingSession.id, existingSession]]);

        storeQuerySession(sessions, newSession, false);

        expect(existingSession.dispose).toHaveBeenCalledOnce();
        expect([...sessions.keys()]).toEqual(['new']);
    });
});
