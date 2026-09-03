/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QueryEditorTab } from '../panels/QueryEditorTab';
import { createExpiringOneShotStore } from './expiringOneShotStore';

const QUERY_APPLY_CONTEXT_TTL_MS = 5 * 60 * 1000;

export interface QueryApplyContext {
    tabId: string;
    endpoint: string;
    databaseId: string;
    containerId: string;
}

const store = createExpiringOneShotStore<QueryApplyContext>(QUERY_APPLY_CONTEXT_TTL_MS);

export function createQueryApplyContext(tab: QueryEditorTab, connection: NoSqlQueryConnection): string {
    return store.create({
        tabId: tab.getId(),
        endpoint: connection.endpoint,
        databaseId: connection.databaseId,
        containerId: connection.containerId,
    });
}

export function takeQueryApplyContext(id: string): QueryApplyContext | undefined {
    return store.take(id);
}
