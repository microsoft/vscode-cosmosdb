/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type NoSqlQueryConnection } from '../../cosmosdb/NoSqlQueryConnection';
import { type QuerySession } from '../../cosmosdb/session/QuerySession';
import { type QueryEditorRouterContext } from './appRouter';
import { matchesQueryConnection } from './querySessionIsolation';

export function requireQueryConnection(ctx: QueryEditorRouterContext, version?: number): NoSqlQueryConnection {
    if (ctx.state.isChangingConnection) {
        throw new Error(l10n.t('The connection is changing. Wait for it to finish and try again.'));
    }
    if (!ctx.state.connection) {
        throw new Error(l10n.t('No connection'));
    }
    if (version !== undefined && version !== ctx.state.connectionVersion) {
        throw staleQueryResultsError();
    }
    return ctx.state.connection;
}

export function staleQueryResultsError(): Error {
    return new Error(l10n.t('These query results are no longer current. Run the query again before using them.'));
}

export function requireQuerySession(ctx: QueryEditorRouterContext, executionId: string | undefined): QuerySession {
    const connection = requireQueryConnection(ctx);
    const session = executionId ? ctx.sessions.get(executionId) : undefined;
    if (!session || session.isDisposed || !matchesQueryConnection(connection, session.connection)) {
        throw staleQueryResultsError();
    }
    return session;
}

export function isCurrentQuerySession(ctx: QueryEditorRouterContext, session: QuerySession): boolean {
    return ctx.sessions.get(session.id) === session && !session.isDisposed;
}

export function commitQueryConnection(ctx: QueryEditorRouterContext, connection?: NoSqlQueryConnection): void {
    ctx.state.connection = connection;
    ctx.state.connectionVersion++;
    ctx.sessions.forEach((session) => session.dispose());
    ctx.sessions.clear();
    for (const pendingRun of ctx.state.pendingRuns.values()) {
        pendingRun.resolve(undefined);
    }
    ctx.state.pendingRuns.clear();
}

export async function changeQueryConnection<T>(ctx: QueryEditorRouterContext, change: () => Promise<T>): Promise<T> {
    if (ctx.state.isChangingConnection) {
        throw new Error(l10n.t('The connection is changing. Wait for it to finish and try again.'));
    }
    ctx.state.isChangingConnection = true;
    try {
        return await change();
    } finally {
        ctx.state.isChangingConnection = false;
    }
}
