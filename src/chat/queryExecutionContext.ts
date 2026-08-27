/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QueryEditorTab } from '../panels/QueryEditorTab';

const QUERY_EXECUTION_CONTEXT_TTL_MS = 5 * 60 * 1000;

export interface QueryExecutionContext {
    tabId: string;
    query: string;
    endpoint: string;
    databaseId: string;
    containerId: string;
}

interface StoredQueryExecutionContext {
    context: QueryExecutionContext;
    expiresAt: number;
}

const queryExecutionContexts = new Map<string, StoredQueryExecutionContext>();

function pruneExpiredQueryExecutionContexts(now = Date.now()): void {
    for (const [id, stored] of queryExecutionContexts) {
        if (stored.expiresAt <= now) {
            queryExecutionContexts.delete(id);
        }
    }
}

export function createQueryExecutionContext(
    tab: QueryEditorTab,
    connection: NoSqlQueryConnection,
    query: string,
): string {
    pruneExpiredQueryExecutionContexts();

    const id = globalThis.crypto.randomUUID();
    queryExecutionContexts.set(id, {
        context: {
            tabId: tab.getId(),
            query,
            endpoint: connection.endpoint,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
        },
        expiresAt: Date.now() + QUERY_EXECUTION_CONTEXT_TTL_MS,
    });
    return id;
}

export function getQueryExecutionContext(id: string): QueryExecutionContext | undefined {
    const stored = queryExecutionContexts.get(id);
    if (!stored) {
        return undefined;
    }
    if (stored.expiresAt <= Date.now()) {
        queryExecutionContexts.delete(id);
        return undefined;
    }
    return stored.context;
}

export function takeQueryExecutionContext(id: string): QueryExecutionContext | undefined {
    const context = getQueryExecutionContext(id);
    queryExecutionContexts.delete(id);
    return context;
}
