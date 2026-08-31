/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QueryEditorTab } from '../panels/QueryEditorTab';
import { createExpiringOneShotStore } from './expiringOneShotStore';

const QUERY_EXECUTION_CONTEXT_TTL_MS = 5 * 60 * 1000;

export interface QueryExecutionContext {
    tabId: string;
    query: string;
    endpoint: string;
    databaseId: string;
    containerId: string;
}

const store = createExpiringOneShotStore<QueryExecutionContext>(QUERY_EXECUTION_CONTEXT_TTL_MS);

export function createQueryExecutionContext(
    tab: QueryEditorTab,
    connection: NoSqlQueryConnection,
    query: string,
): string {
    return store.create({
        tabId: tab.getId(),
        query,
        endpoint: connection.endpoint,
        databaseId: connection.databaseId,
        containerId: connection.containerId,
    });
}

export function getQueryExecutionContext(id: string): QueryExecutionContext | undefined {
    return store.peek(id);
}

export function takeQueryExecutionContext(id: string): QueryExecutionContext | undefined {
    return store.take(id);
}
