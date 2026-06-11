/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { CosmosDbOperationsService, type QueryHistoryContext } from './CosmosDbOperationsService';

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
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
    parseError: vi.fn((e: unknown) => ({ message: String(e) })),
}));

vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    },
}));

vi.mock('../panels/QueryEditorTab', () => ({
    QueryEditorTab: {
        openTabs: new Set(),
    },
}));

vi.mock('../services/SchemaService', () => ({
    SchemaService: {
        getInstance: vi.fn(() => ({
            getSimplifiedSchema: vi.fn(),
            mergeDocumentsIntoSchema: vi.fn(),
        })),
    },
}));

vi.mock('../utils/aiUtils', () => ({
    extractJsonObject: vi.fn(),
    getSelectedModel: vi.fn(),
}));

vi.mock('../utils/sanitization', () => ({
    commentOutQuery: vi.fn((q: string) => `-- ${q}`),
    sanitizeSqlComment: vi.fn((s: string) => s),
    stripCodeFences: vi.fn((s: string) => s),
}));

vi.mock('./chatUtils', () => ({
    buildChatMessages: vi.fn(),
    getActiveQueryEditor: vi.fn(),
    getConnectionFromQueryTab: vi.fn(),
    sendChatRequest: vi.fn(),
}));

vi.mock('./queryOneShotExamples', () => ({
    buildQueryOneShotMessages: vi.fn(() => []),
}));

vi.mock('./sampleDataTool', () => ({
    SAMPLE_DATA_CONFIRMATION_MESSAGE: 'mock confirmation',
    SAMPLE_DATA_TOOL_NAME: 'cosmosdb_sampleContainerSchema',
    sampleAndPersistContainerSchema: vi.fn(),
}));

vi.mock('./systemPrompt', () => ({
    JSON_RESPONSE_FORMAT_WITH_EXPLANATION: 'mock format',
    QUERY_EXPLANATION_PROMPT_TEMPLATE: 'mock template {contextInfo} {query} {userPrompt}',
    QUERY_GENERATION_SYSTEM_PROMPT: 'mock system prompt',
}));

vi.mock('./userPayload', () => ({
    buildQueryGenerationUserContent: vi.fn(() => 'mock user content'),
    type: undefined,
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
                    query: 'SELECT * FROM c',
                    documents: [{ id: '1', name: 'test' }],
                    requestCharge: 2.5,
                }),
            );

            const history = service.getQueryHistoryForContainer('acc1', 'db1', 'container1');

            expect(history).toBeDefined();
            expect(history!.databaseId).toBe('db1');
            expect(history!.containerId).toBe('container1');
            expect(history!.executions).toHaveLength(1);
            expect(history!.executions[0].query).toBe('SELECT * FROM c');
            expect(history!.executions[0].documentCount).toBe(1);
            expect(history!.executions[0].requestCharge).toBe(2.5);
        });

        it('should strip comments from stored queries', () => {
            service.recordQueryExecution(
                'acc1',
                'db1',
                'c1',
                makeResult({
                    query: '-- Previous query:\n-- SELECT c.id FROM c\nSELECT * FROM c',
                }),
            );

            const history = service.getQueryHistoryForContainer('acc1', 'db1', 'c1');

            expect(history!.executions[0].query).toBe('SELECT * FROM c');
        });

        it('should deduplicate queries keeping the most recent', () => {
            service.recordQueryExecution(
                'acc1',
                'db1',
                'c1',
                makeResult({
                    query: 'SELECT * FROM c',
                    documents: [{ id: '1' }],
                    requestCharge: 1.0,
                }),
            );

            service.recordQueryExecution(
                'acc1',
                'db1',
                'c1',
                makeResult({
                    query: 'SELECT c.name FROM c',
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
                    query: 'SELECT * FROM c',
                    documents: [{ id: '3' }, { id: '4' }],
                    requestCharge: 3.0,
                }),
            );

            const history = service.getQueryHistoryForContainer('acc1', 'db1', 'c1');

            expect(history!.executions).toHaveLength(2);
            // Most recent first
            expect(history!.executions[0].query).toBe('SELECT * FROM c');
            expect(history!.executions[0].documentCount).toBe(2);
            expect(history!.executions[0].requestCharge).toBe(3.0);
            expect(history!.executions[1].query).toBe('SELECT c.name FROM c');
        });

        it('should use undefined accountId gracefully', () => {
            service.recordQueryExecution(undefined, 'db1', 'c1', makeResult({ query: 'SELECT * FROM c' }));

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
            service.recordQueryExecution('acc', 'db1', 'c1', makeResult({ query: 'SELECT * FROM c' }));

            service.recordQueryExecution('acc', 'db1', 'c2', makeResult({ query: 'SELECT c.name FROM c' }));

            const history1 = service.getQueryHistoryForContainer('acc', 'db1', 'c1');
            const history2 = service.getQueryHistoryForContainer('acc', 'db1', 'c2');

            expect(history1!.executions).toHaveLength(1);
            expect(history1!.executions[0].query).toBe('SELECT * FROM c');
            expect(history2!.executions).toHaveLength(1);
            expect(history2!.executions[0].query).toBe('SELECT c.name FROM c');
        });
    });

    describe('recordSampledSchema', () => {
        it('should store sampled schema as a query history entry', () => {
            service.recordSampledSchema('acc', 'db', 'c1', 'SELECT TOP 10 * FROM c', 10, {
                id: 'string',
                name: 'string',
            });

            const history = service.getQueryHistoryForContainer('acc', 'db', 'c1');

            expect(history).toBeDefined();
            expect(history!.executions).toHaveLength(1);
            expect(history!.executions[0].query).toBe('SELECT TOP 10 * FROM c');
            expect(history!.executions[0].documentCount).toBe(10);
            expect(history!.executions[0].simplifiedSchema).toEqual({ id: 'string', name: 'string' });
        });

        it('should replace previous schema sampling entry', () => {
            service.recordSampledSchema('acc', 'db', 'c1', 'SELECT TOP 10 * FROM c', 5, { id: 'string' });
            service.recordSampledSchema('acc', 'db', 'c1', 'SELECT TOP 10 * FROM c', 8, {
                id: 'string',
                name: 'string',
            });

            const history = service.getQueryHistoryForContainer('acc', 'db', 'c1');

            expect(history!.executions).toHaveLength(1);
            expect(history!.executions[0].documentCount).toBe(8);
            expect(history!.executions[0].simplifiedSchema).toEqual({ id: 'string', name: 'string' });
        });

        it('should include request charge when provided', () => {
            service.recordSampledSchema('acc', 'db', 'c1', 'SELECT TOP 10 * FROM c', 5, { id: 'string' }, 12.3);

            const history = service.getQueryHistoryForContainer('acc', 'db', 'c1');

            expect(history!.executions[0].requestCharge).toBe(12.3);
        });
    });

    describe('clearQueryHistory', () => {
        it('should clear history for a specific container', () => {
            service.recordQueryExecution('acc', 'db', 'c1', makeResult({ query: 'SELECT * FROM c' }));
            service.recordQueryExecution('acc', 'db', 'c2', makeResult({ query: 'SELECT * FROM c' }));

            service.clearQueryHistory('acc', 'db', 'c1');

            expect(service.getQueryHistoryForContainer('acc', 'db', 'c1')).toBeUndefined();
            expect(service.getQueryHistoryForContainer('acc', 'db', 'c2')).toBeDefined();
        });
    });

    describe('clearAllQueryHistory', () => {
        it('should clear all history', () => {
            service.recordQueryExecution('acc', 'db', 'c1', makeResult({ query: 'SELECT * FROM c' }));
            service.recordQueryExecution('acc', 'db', 'c2', makeResult({ query: 'SELECT * FROM c' }));

            service.clearAllQueryHistory();

            expect(service.getQueryHistoryForContainer('acc', 'db', 'c1')).toBeUndefined();
            expect(service.getQueryHistoryForContainer('acc', 'db', 'c2')).toBeUndefined();
        });
    });

    describe('formatQueryHistoryForLLM', () => {
        it('should return empty string for empty history', () => {
            const result = service.formatQueryHistoryForLLM({
                databaseId: 'db',
                containerId: 'c',
                executions: [],
            });

            expect(result).toBe('');
        });

        it('should format single query execution', () => {
            const history: QueryHistoryContext = {
                databaseId: 'testDb',
                containerId: 'testContainer',
                executions: [
                    {
                        query: 'SELECT * FROM c WHERE c.active = true',
                        documentCount: 7,
                        requestCharge: 3.5,
                    },
                ],
            };

            const result = service.formatQueryHistoryForLLM(history);

            expect(result).toContain('testDb');
            expect(result).toContain('testContainer');
            expect(result).toContain('SELECT * FROM c WHERE c.active = true');
            expect(result).toContain('7 documents');
            expect(result).toContain('3.50 RUs');
        });

        it('should format multiple executions with numbered headers', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'c',
                executions: [
                    { query: 'SELECT * FROM c', documentCount: 10 },
                    { query: 'SELECT c.id FROM c', documentCount: 5 },
                ],
            };

            const result = service.formatQueryHistoryForLLM(history);

            expect(result).toContain('### Query 1');
            expect(result).toContain('### Query 2');
        });

        it('should include simplified schema in output', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'c',
                executions: [
                    {
                        query: 'SELECT * FROM c',
                        documentCount: 1,
                        simplifiedSchema: { id: 'string', status: 'boolean' },
                    },
                ],
            };

            const result = service.formatQueryHistoryForLLM(history);

            expect(result).toContain('Inferred Schema');
            expect(result).toContain('"id"');
            expect(result).toContain('"status"');
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
});
