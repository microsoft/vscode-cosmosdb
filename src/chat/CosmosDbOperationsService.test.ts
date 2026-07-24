/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { CosmosDbOperationsService } from './CosmosDbOperationsService';

// ─── Shared string constants (used in both mock setup and assertions) ────────
const QUERY_SELECT_ALL = 'SELECT * FROM c';
const QUERY_SELECT_NAME = 'SELECT c.name FROM c';

function makeResult(overrides: Partial<SerializedQueryResult> & { query: string }): SerializedQueryResult {
    return {
        documents: [],
        iteration: 1,
        metadata: {},
        indexMetrics: '',
        requestCharge: 0,
        roundTrips: 1,
        hasMoreResults: false,
        ...overrides,
    };
}

// Mock dependencies that are not under test
vi.mock('../panels/QueryEditorTab', () => ({
    QueryEditorTab: {
        openTabs: new Set(),
    },
}));

vi.mock('./chatUtils', () => ({
    getConnectionFromQueryTab: vi.fn(),
}));

describe('CosmosDbOperationsService', () => {
    let service: CosmosDbOperationsService;

    beforeEach(() => {
        // Reset singleton so each test gets a fresh instance
        (CosmosDbOperationsService as any).instance = undefined;
        service = CosmosDbOperationsService.getInstance();
    });

    describe('getInstance', () => {
        it('should return a singleton instance', () => {
            const instance1 = CosmosDbOperationsService.getInstance();
            const instance2 = CosmosDbOperationsService.getInstance();

            expect(instance1).toBe(instance2);
        });
    });

    describe('recordQueryExecution', () => {
        it('should store a query execution entry', () => {
            service.recordQueryExecution(
                'acc1',
                'db1',
                'container1',
                makeResult({
                    query: QUERY_SELECT_ALL,
                    documents: [{ id: '1', name: 'test' }],
                    requestCharge: 2.5,
                }),
            );

            const history = service.getQueryHistoryForContainer('acc1', 'db1', 'container1');

            expect(history).toBeDefined();
            expect(history!.databaseId).toBe('db1');
            expect(history!.containerId).toBe('container1');
            expect(history!.executions).toHaveLength(1);
            expect(history!.executions[0].query).toBe(QUERY_SELECT_ALL);
            expect(history!.executions[0].documentCount).toBe(1);
            expect(history!.executions[0].requestCharge).toBe(2.5);
        });

        it('should strip comments from stored queries', () => {
            service.recordQueryExecution(
                'acc1',
                'db1',
                'c1',
                makeResult({
                    query: `-- Previous query:\n-- SELECT c.id FROM c\n${QUERY_SELECT_ALL}`,
                }),
            );

            const history = service.getQueryHistoryForContainer('acc1', 'db1', 'c1');

            expect(history!.executions[0].query).toBe(QUERY_SELECT_ALL);
        });

        it('should deduplicate queries keeping the most recent', () => {
            service.recordQueryExecution(
                'acc1',
                'db1',
                'c1',
                makeResult({
                    query: QUERY_SELECT_ALL,
                    documents: [{ id: '1' }],
                    requestCharge: 1.0,
                }),
            );

            service.recordQueryExecution(
                'acc1',
                'db1',
                'c1',
                makeResult({
                    query: QUERY_SELECT_NAME,
                    documents: [{ id: '2' }],
                    requestCharge: 2.0,
                }),
            );

            // Record the first query again with different results
            service.recordQueryExecution(
                'acc1',
                'db1',
                'c1',
                makeResult({
                    query: QUERY_SELECT_ALL,
                    documents: [{ id: '3' }, { id: '4' }],
                    requestCharge: 3.0,
                }),
            );

            const history = service.getQueryHistoryForContainer('acc1', 'db1', 'c1');

            expect(history!.executions).toHaveLength(2);
            // Most recent first
            expect(history!.executions[0].query).toBe(QUERY_SELECT_ALL);
            expect(history!.executions[0].documentCount).toBe(2);
            expect(history!.executions[0].requestCharge).toBe(3.0);
            expect(history!.executions[1].query).toBe(QUERY_SELECT_NAME);
        });

        it('should use undefined accountId gracefully', () => {
            service.recordQueryExecution(undefined, 'db1', 'c1', makeResult({ query: QUERY_SELECT_ALL }));

            const history = service.getQueryHistoryForContainer(undefined, 'db1', 'c1');

            expect(history).toBeDefined();
            expect(history!.executions).toHaveLength(1);
        });
    });

    describe('getQueryHistoryForContainer', () => {
        it('should return undefined when no history exists', () => {
            const history = service.getQueryHistoryForContainer('acc', 'db', 'container');

            expect(history).toBeUndefined();
        });

        it('should return history scoped to the correct container', () => {
            service.recordQueryExecution('acc', 'db1', 'c1', makeResult({ query: QUERY_SELECT_ALL }));

            service.recordQueryExecution('acc', 'db1', 'c2', makeResult({ query: QUERY_SELECT_NAME }));

            const history1 = service.getQueryHistoryForContainer('acc', 'db1', 'c1');
            const history2 = service.getQueryHistoryForContainer('acc', 'db1', 'c2');

            expect(history1!.executions).toHaveLength(1);
            expect(history1!.executions[0].query).toBe(QUERY_SELECT_ALL);
            expect(history2!.executions).toHaveLength(1);
            expect(history2!.executions[0].query).toBe(QUERY_SELECT_NAME);
        });
    });

    describe('history size limits', () => {
        it('should not exceed the max history entries per container', () => {
            // Record more than 20 queries (MAX_QUERY_HISTORY_PER_CONTAINER)
            for (let i = 0; i < 25; i++) {
                service.recordQueryExecution(
                    'acc',
                    'db',
                    'c1',
                    makeResult({ query: `SELECT * FROM c WHERE c.i = ${i}` }),
                );
            }

            const history = service.getQueryHistoryForContainer('acc', 'db', 'c1');

            expect(history!.executions.length).toBeLessThanOrEqual(20);
            // Most recent should be first
            expect(history!.executions[0].query).toBe('SELECT * FROM c WHERE c.i = 24');
        });
    });

    describe('getQueryHistoryContext', () => {
        it('should return history context from active editor connection', async () => {
            const { getConnectionFromQueryTab } = vi.mocked(await import('./chatUtils'));
            const mockConnection = {
                databaseId: 'db1',
                containerId: 'c1',
                azureMetadata: { accountId: 'acc1' },
            };
            getConnectionFromQueryTab.mockReturnValue(mockConnection as any);

            service.recordQueryExecution(
                'acc1',
                'db1',
                'c1',
                makeResult({ query: QUERY_SELECT_ALL, documents: [{ id: '1' }] }),
            );

            const mockEditor = {} as any;
            const result = service.getQueryHistoryContext(mockEditor);

            expect(result).toBeDefined();
            expect(result!.databaseId).toBe('db1');
            expect(result!.containerId).toBe('c1');
            expect(result!.executions).toHaveLength(1);
        });

        it('should return undefined when editor has no connection', async () => {
            const { getConnectionFromQueryTab } = vi.mocked(await import('./chatUtils'));
            getConnectionFromQueryTab.mockReturnValue(undefined);

            const mockEditor = {} as any;
            const result = service.getQueryHistoryContext(mockEditor);

            expect(result).toBeUndefined();
        });

        it('should return undefined when no history exists for the connection', async () => {
            const { getConnectionFromQueryTab } = vi.mocked(await import('./chatUtils'));
            const mockConnection = {
                databaseId: 'db1',
                containerId: 'c1',
                azureMetadata: { accountId: 'acc1' },
            };
            getConnectionFromQueryTab.mockReturnValue(mockConnection as any);

            const mockEditor = {} as any;
            const result = service.getQueryHistoryContext(mockEditor);

            expect(result).toBeUndefined();
        });
    });
});
