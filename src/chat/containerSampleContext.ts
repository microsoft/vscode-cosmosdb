/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QueryEditorTab } from '../panels/QueryEditorTab';
import { createExpiringOneShotStore } from './expiringOneShotStore';

const CONTAINER_SAMPLE_CONTEXT_TTL_MS = 5 * 60 * 1000;

/**
 * Immutable snapshot of the exact Query Editor tab + container a schema-sampling confirmation was
 * built for. `cosmosdb_getQueryEditorContext` mints one and `cosmosdb_sampleContainerSchema`
 * consumes it, so sampling always reads the container the user confirmed — even if they switch tabs
 * or the editor reconnects while the confirmation prompt is open. Unlike a query-execution context
 * it carries no query text: the sampling query is a fixed, read-only `SELECT TOP 10`.
 */
export interface ContainerSampleContext {
    tabId: string;
    endpoint: string;
    databaseId: string;
    containerId: string;
}

const store = createExpiringOneShotStore<ContainerSampleContext>(CONTAINER_SAMPLE_CONTEXT_TTL_MS);

export function createContainerSampleContext(tab: QueryEditorTab, connection: NoSqlQueryConnection): string {
    return store.create({
        tabId: tab.getId(),
        endpoint: connection.endpoint,
        databaseId: connection.databaseId,
        containerId: connection.containerId,
    });
}

export function getContainerSampleContext(id: string): ContainerSampleContext | undefined {
    return store.peek(id);
}

export function takeContainerSampleContext(id: string): ContainerSampleContext | undefined {
    return store.take(id);
}
