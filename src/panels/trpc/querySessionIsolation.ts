/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface QueryConnectionIdentity {
    endpoint: string;
    databaseId: string;
    containerId: string;
}

interface DisposableQuerySession {
    readonly id: string;
    dispose(): void;
}

export function matchesQueryConnection(
    connection: QueryConnectionIdentity,
    expectedConnection: QueryConnectionIdentity | undefined,
): boolean {
    return (
        !expectedConnection ||
        (connection.endpoint === expectedConnection.endpoint &&
            connection.databaseId === expectedConnection.databaseId &&
            connection.containerId === expectedConnection.containerId)
    );
}

export function storeQuerySession<T extends DisposableQuerySession>(
    sessions: Map<string, T>,
    session: T,
    preserveExistingSessions: boolean,
): void {
    if (!preserveExistingSessions) {
        sessions.forEach((existingSession) => existingSession.dispose());
        sessions.clear();
    }
    sessions.set(session.id, session);
}

export function cleanUpSupersededReadSessions<T extends DisposableQuerySession>(
    sessions: Map<string, T>,
    readSessionIds: Set<string>,
): void {
    const activeSessionId = [...sessions.keys()].at(-1);
    for (const sessionId of readSessionIds) {
        if (sessionId === activeSessionId) {
            continue;
        }
        const session = sessions.get(sessionId);
        sessions.delete(sessionId);
        readSessionIds.delete(sessionId);
        session?.dispose();
    }
}
