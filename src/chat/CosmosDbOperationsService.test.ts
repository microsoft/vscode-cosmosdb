/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as vscode from 'vscode';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import {
    CosmosDbOperationsService,
    QueryGenerationRefusedError,
    type QueryHistoryContext,
} from './CosmosDbOperationsService';

// ─── Shared string constants (used in both mock setup and assertions) ────────
const QUERY_SELECT_ALL = 'SELECT * FROM c';
const QUERY_SELECT_NAME = 'SELECT c.name FROM c';
const QUERY_SELECT_ID = 'SELECT c.id FROM c';
const QUERY_SELECT_ACTIVE = 'SELECT * FROM c WHERE c.active = true';
const QUERY_SELECT_BY_TYPE = 'SELECT * FROM c WHERE c.type = "user"';
const QUERY_SELECT_TOP_10 = 'SELECT TOP 10 * FROM c';
const QUERY_EXPLANATION_ACTIVE = 'This query finds active documents';
const ERROR_NO_MODELS = 'No models available';
const ERROR_NOT_QUERY_RELATED = 'This is not a query-related request';

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
            debug: vi.fn(),
            appendLine: vi.fn(),
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

        // Ensure vscode.lm exists for tests that need it
        if (!vscode.lm) {
            (vscode as any).lm = { tools: [] };
        } else {
            (vscode.lm as any).tools = [];
        }

        // Ensure vscode.LanguageModelChatMessage is available
        if (!vscode.LanguageModelChatMessage) {
            (vscode as any).LanguageModelChatMessage = {
                User: (content: string) => ({ role: 1, content }),
                Assistant: (content: string | unknown[]) => ({ role: 2, content }),
            };
        }

        // Ensure vscode.LanguageModelTextPart is available
        if (!vscode.LanguageModelTextPart) {
            (vscode as any).LanguageModelTextPart = class LanguageModelTextPart {
                constructor(public value: string) {}
            };
        }

        // Ensure vscode.CancellationTokenSource is available
        if (!vscode.CancellationTokenSource) {
            (vscode as any).CancellationTokenSource = class CancellationTokenSource {
                token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
                cancel = vi.fn();
                dispose = vi.fn();
            };
        }
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

    describe('recordSampledSchema', () => {
        it('should store sampled schema as a query history entry', () => {
            service.recordSampledSchema('acc', 'db', 'c1', QUERY_SELECT_TOP_10, 10, {
                id: 'string',
                name: 'string',
            });

            const history = service.getQueryHistoryForContainer('acc', 'db', 'c1');

            expect(history).toBeDefined();
            expect(history!.executions).toHaveLength(1);
            expect(history!.executions[0].query).toBe(QUERY_SELECT_TOP_10);
            expect(history!.executions[0].documentCount).toBe(10);
            expect(history!.executions[0].simplifiedSchema).toEqual({ id: 'string', name: 'string' });
        });

        it('should replace previous schema sampling entry', () => {
            service.recordSampledSchema('acc', 'db', 'c1', QUERY_SELECT_TOP_10, 5, { id: 'string' });
            service.recordSampledSchema('acc', 'db', 'c1', QUERY_SELECT_TOP_10, 8, {
                id: 'string',
                name: 'string',
            });

            const history = service.getQueryHistoryForContainer('acc', 'db', 'c1');

            expect(history!.executions).toHaveLength(1);
            expect(history!.executions[0].documentCount).toBe(8);
            expect(history!.executions[0].simplifiedSchema).toEqual({ id: 'string', name: 'string' });
        });

        it('should include request charge when provided', () => {
            service.recordSampledSchema('acc', 'db', 'c1', QUERY_SELECT_TOP_10, 5, { id: 'string' }, 12.3);

            const history = service.getQueryHistoryForContainer('acc', 'db', 'c1');

            expect(history!.executions[0].requestCharge).toBe(12.3);
        });
    });

    describe('clearQueryHistory', () => {
        it('should clear history for a specific container', () => {
            service.recordQueryExecution('acc', 'db', 'c1', makeResult({ query: QUERY_SELECT_ALL }));
            service.recordQueryExecution('acc', 'db', 'c2', makeResult({ query: QUERY_SELECT_ALL }));

            service.clearQueryHistory('acc', 'db', 'c1');

            expect(service.getQueryHistoryForContainer('acc', 'db', 'c1')).toBeUndefined();
            expect(service.getQueryHistoryForContainer('acc', 'db', 'c2')).toBeDefined();
        });
    });

    describe('clearAllQueryHistory', () => {
        it('should clear all history', () => {
            service.recordQueryExecution('acc', 'db', 'c1', makeResult({ query: QUERY_SELECT_ALL }));
            service.recordQueryExecution('acc', 'db', 'c2', makeResult({ query: QUERY_SELECT_ALL }));

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
                        query: QUERY_SELECT_ACTIVE,
                        documentCount: 7,
                        requestCharge: 3.5,
                    },
                ],
            };

            const result = service.formatQueryHistoryForLLM(history);

            expect(result).toContain('testDb');
            expect(result).toContain('testContainer');
            expect(result).toContain(QUERY_SELECT_ACTIVE);
            expect(result).toContain('7 documents');
            expect(result).toContain('3.50 RUs');
        });

        it('should format multiple executions with numbered headers', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'c',
                executions: [
                    { query: QUERY_SELECT_ALL, documentCount: 10 },
                    { query: QUERY_SELECT_ID, documentCount: 5 },
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
                        query: QUERY_SELECT_ALL,
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

    describe('getActiveEditorQuery', () => {
        it('should return undefined when no query editors are open', async () => {
            const { QueryEditorTab } = vi.mocked(await import('../panels/QueryEditorTab'));
            (QueryEditorTab.openTabs as any) = new Set();

            const result = service.getActiveEditorQuery();

            expect(result).toBeUndefined();
        });

        it('should return the selected query when available', async () => {
            const { QueryEditorTab } = vi.mocked(await import('../panels/QueryEditorTab'));
            const { getActiveQueryEditor, getConnectionFromQueryTab } = vi.mocked(await import('./chatUtils'));

            const mockEditor = {
                getCurrentQueryResults: vi.fn().mockReturnValue(undefined),
                getCurrentQuery: vi.fn().mockReturnValue(QUERY_SELECT_ALL),
                getSelectedQuery: vi.fn().mockReturnValue(QUERY_SELECT_ID),
                isActive: vi.fn().mockReturnValue(true),
                isVisible: vi.fn().mockReturnValue(true),
            };
            (QueryEditorTab.openTabs as any) = new Set([mockEditor]);
            getActiveQueryEditor.mockReturnValue(mockEditor as any);
            getConnectionFromQueryTab.mockReturnValue({
                databaseId: 'db',
                containerId: 'c',
            } as any);

            const result = service.getActiveEditorQuery();

            expect(result).toBe(QUERY_SELECT_ID);
        });

        it('should fall back to full editor query when no selection', async () => {
            const { QueryEditorTab } = vi.mocked(await import('../panels/QueryEditorTab'));
            const { getActiveQueryEditor, getConnectionFromQueryTab } = vi.mocked(await import('./chatUtils'));

            const mockEditor = {
                getCurrentQueryResults: vi.fn().mockReturnValue(undefined),
                getCurrentQuery: vi.fn().mockReturnValue(QUERY_SELECT_ALL),
                getSelectedQuery: vi.fn().mockReturnValue(undefined),
                isActive: vi.fn().mockReturnValue(true),
                isVisible: vi.fn().mockReturnValue(true),
            };
            (QueryEditorTab.openTabs as any) = new Set([mockEditor]);
            getActiveQueryEditor.mockReturnValue(mockEditor as any);
            getConnectionFromQueryTab.mockReturnValue({
                databaseId: 'db',
                containerId: 'c',
            } as any);

            const result = service.getActiveEditorQuery();

            expect(result).toBe(QUERY_SELECT_ALL);
        });
    });

    describe('formatQueryHistoryForLLM - schema resolution', () => {
        it('should format execution with JSONSchema using simplifySchemaForLLM', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'c',
                executions: [
                    {
                        query: QUERY_SELECT_ALL,
                        documentCount: 1,
                        schema: {
                            type: 'object',
                            properties: {
                                id: {
                                    anyOf: [{ type: 'string' }],
                                },
                                count: {
                                    anyOf: [{ type: 'number' }],
                                },
                            },
                        },
                    },
                ],
            };

            const result = service.formatQueryHistoryForLLM(history);

            expect(result).toContain('Inferred Schema');
            expect(result).toContain('"id"');
            expect(result).toContain('"count"');
        });

        it('should prefer simplifiedSchema over schema when both present', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'c',
                executions: [
                    {
                        query: QUERY_SELECT_ALL,
                        documentCount: 1,
                        simplifiedSchema: { name: 'string' },
                        schema: {
                            type: 'object',
                            properties: {
                                differentField: { anyOf: [{ type: 'number' }] },
                            },
                        },
                    },
                ],
            };

            const result = service.formatQueryHistoryForLLM(history);

            // simplifiedSchema should be used, not the raw schema
            expect(result).toContain('"name"');
            expect(result).not.toContain('"differentField"');
        });

        it('should omit schema section when neither schema nor simplifiedSchema is present', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'c',
                executions: [
                    {
                        query: QUERY_SELECT_ALL,
                        documentCount: 5,
                    },
                ],
            };

            const result = service.formatQueryHistoryForLLM(history);

            expect(result).not.toContain('Inferred Schema');
        });

        it('should omit request charge when not present', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'c',
                executions: [
                    {
                        query: QUERY_SELECT_ALL,
                        documentCount: 3,
                    },
                ],
            };

            const result = service.formatQueryHistoryForLLM(history);

            expect(result).toContain('3 documents');
            expect(result).not.toContain('RUs');
        });
    });

    describe('executeOperation', () => {
        it('should return error message for unknown operation', async () => {
            const result = await service.executeOperation('unknownOp');

            expect(result).toContain('Error executing');
        });

        it('should return message when editQuery has no currentQuery', async () => {
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));
            // Make callWithTelemetryAndErrorHandling invoke the callback
            callWithTelemetryAndErrorHandling.mockImplementation(async (_name: string, callback: any) => {
                const ctx = {
                    errorHandling: { suppressDisplay: false },
                    telemetry: { properties: {}, measurements: {} },
                };
                return callback(ctx);
            });

            const result = await service.executeOperation('editQuery', {
                currentQuery: '',
            });

            // When no active editor, it should throw and result in error message
            expect(typeof result).toBe('string');
        });

        it('should return message when generateQuery has no userPrompt', async () => {
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));
            callWithTelemetryAndErrorHandling.mockImplementation(async (_name: string, callback: any) => {
                const ctx = {
                    errorHandling: { suppressDisplay: false },
                    telemetry: { properties: {}, measurements: {} },
                };
                return callback(ctx);
            });

            const result = await service.executeOperation('generateQuery', {
                userPrompt: '',
            });

            expect(result).toContain('Please provide a description');
        });

        it('should return message when explainQuery has no currentQuery', async () => {
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));
            callWithTelemetryAndErrorHandling.mockImplementation(async (_name: string, callback: any) => {
                const ctx = {
                    errorHandling: { suppressDisplay: false },
                    telemetry: { properties: {}, measurements: {} },
                };
                return callback(ctx);
            });

            const result = await service.executeOperation('explainQuery', {
                currentQuery: '',
            });

            expect(result).toContain('no query to analyze');
        });
    });

    describe('QueryGenerationRefusedError', () => {
        it('should have the correct name', () => {
            const error = new QueryGenerationRefusedError('test message');
            expect(error.name).toBe('QueryGenerationRefusedError');
            expect(error.message).toBe('test message');
        });

        it('should be an instance of Error', () => {
            const error = new QueryGenerationRefusedError('refused');
            expect(error).toBeInstanceOf(Error);
        });
    });

    describe('generateQueryWithLLM', () => {
        it('should throw when no language model is available', async () => {
            const { getSelectedModel } = vi.mocked(await import('../utils/aiUtils'));
            getSelectedModel.mockRejectedValue(new Error(ERROR_NO_MODELS));

            await expect(service.generateQueryWithLLM('find users', '')).rejects.toThrow(ERROR_NO_MODELS);
        });

        it('should generate a query using the LLM and return plain text', async () => {
            const { getSelectedModel } = vi.mocked(await import('../utils/aiUtils'));
            const { stripCodeFences } = vi.mocked(await import('../utils/sanitization'));
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));

            // Make telemetry calls pass through silently
            callWithTelemetryAndErrorHandling.mockImplementation(async () => undefined);

            // stripCodeFences should return cleaned text
            stripCodeFences.mockImplementation((s: string) => s);

            // Create mock model
            const mockStream = (async function* () {
                yield new vscode.LanguageModelTextPart(QUERY_SELECT_BY_TYPE);
            })();
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue({ stream: mockStream }),
                countTokens: vi.fn().mockResolvedValue(10),
                name: 'test-model',
                family: 'test-family',
                id: 'test-id',
                maxInputTokens: 4096,
            };
            getSelectedModel.mockResolvedValue(mockModel as any);

            const result = await service.generateQueryWithLLM('find all users', '');

            expect(typeof result).toBe('string');
            expect(result).toContain(QUERY_SELECT_ALL);
        });

        it('should generate a query with explanation when withExplanation is true', async () => {
            const { getSelectedModel } = vi.mocked(await import('../utils/aiUtils'));
            const { extractJsonObject } = vi.mocked(await import('../utils/aiUtils'));
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));

            callWithTelemetryAndErrorHandling.mockImplementation(async () => undefined);

            const responseJson = JSON.stringify({
                query: QUERY_SELECT_ACTIVE,
                explanation: QUERY_EXPLANATION_ACTIVE,
            });

            const mockStream = (async function* () {
                yield new vscode.LanguageModelTextPart(responseJson);
            })();
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue({ stream: mockStream }),
                countTokens: vi.fn().mockResolvedValue(10),
                name: 'test-model',
                family: 'test-family',
                id: 'test-id',
                maxInputTokens: 4096,
            };
            getSelectedModel.mockResolvedValue(mockModel as any);
            extractJsonObject.mockReturnValue(responseJson);

            const result = await service.generateQueryWithLLM('find active items', '', {
                withExplanation: true,
            });

            expect(result).toHaveProperty('query');
            expect(result).toHaveProperty('explanation');
            expect((result as any).query).toContain(QUERY_SELECT_ACTIVE);
            expect((result as any).explanation).toBe(QUERY_EXPLANATION_ACTIVE);
        });

        it('should throw QueryGenerationRefusedError when LLM returns error field', async () => {
            const { getSelectedModel, extractJsonObject } = vi.mocked(await import('../utils/aiUtils'));
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));

            callWithTelemetryAndErrorHandling.mockImplementation(async () => undefined);

            const responseJson = JSON.stringify({
                query: '',
                explanation: '',
                error: ERROR_NOT_QUERY_RELATED,
            });

            const mockStream = (async function* () {
                yield new vscode.LanguageModelTextPart(responseJson);
            })();
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue({ stream: mockStream }),
                countTokens: vi.fn().mockResolvedValue(10),
                name: 'test-model',
                family: 'test-family',
                id: 'test-id',
                maxInputTokens: 4096,
            };
            getSelectedModel.mockResolvedValue(mockModel as any);
            extractJsonObject.mockReturnValue(responseJson);

            await expect(service.generateQueryWithLLM('tell me a joke', '', { withExplanation: true })).rejects.toThrow(
                QueryGenerationRefusedError,
            );
        });

        it('should throw when LLM returns invalid JSON with withExplanation', async () => {
            const { getSelectedModel, extractJsonObject } = vi.mocked(await import('../utils/aiUtils'));
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));

            callWithTelemetryAndErrorHandling.mockImplementation(async () => undefined);

            const mockStream = (async function* () {
                yield new vscode.LanguageModelTextPart('not valid json');
            })();
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue({ stream: mockStream }),
                countTokens: vi.fn().mockResolvedValue(10),
                name: 'test-model',
                family: 'test-family',
                id: 'test-id',
                maxInputTokens: 4096,
            };
            getSelectedModel.mockResolvedValue(mockModel as any);
            extractJsonObject.mockReturnValue(null);

            await expect(service.generateQueryWithLLM('find users', '', { withExplanation: true })).rejects.toThrow(
                'Invalid LLM response',
            );
        });

        it('should throw QueryGenerationRefusedError for plain text ERROR: response', async () => {
            const { getSelectedModel } = vi.mocked(await import('../utils/aiUtils'));
            const { stripCodeFences } = vi.mocked(await import('../utils/sanitization'));
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));

            callWithTelemetryAndErrorHandling.mockImplementation(async () => undefined);
            stripCodeFences.mockImplementation((s: string) => s);

            const mockStream = (async function* () {
                yield new vscode.LanguageModelTextPart('ERROR: Cannot generate this query');
            })();
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue({ stream: mockStream }),
                countTokens: vi.fn().mockResolvedValue(10),
                name: 'test-model',
                family: 'test-family',
                id: 'test-id',
                maxInputTokens: 4096,
            };
            getSelectedModel.mockResolvedValue(mockModel as any);

            await expect(service.generateQueryWithLLM('do something invalid', '')).rejects.toThrow(
                QueryGenerationRefusedError,
            );
        });

        it('should report progress callback during generation', async () => {
            const { getSelectedModel } = vi.mocked(await import('../utils/aiUtils'));
            const { stripCodeFences } = vi.mocked(await import('../utils/sanitization'));
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));

            callWithTelemetryAndErrorHandling.mockImplementation(async () => undefined);
            stripCodeFences.mockImplementation((s: string) => s);

            const mockStream = (async function* () {
                yield new vscode.LanguageModelTextPart(QUERY_SELECT_ALL);
            })();
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue({ stream: mockStream }),
                countTokens: vi.fn().mockResolvedValue(10),
                name: 'test-model',
                family: 'test-family',
                id: 'test-id',
                maxInputTokens: 4096,
            };
            getSelectedModel.mockResolvedValue(mockModel as any);

            const onProgress = vi.fn();
            await service.generateQueryWithLLM('find items', '', { onProgress });

            expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Generating query'));
        });
    });

    describe('simplifySchemaForLLM (via formatQueryHistoryForLLM)', () => {
        it('simplifies nested objects, typed arrays and union types', () => {
            const schema = {
                type: 'object',
                properties: {
                    tags: { anyOf: [{ type: 'array', items: { type: 'string' } }] },
                    mixed: { anyOf: [{ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } }] },
                    union: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                    nested: { anyOf: [{ type: 'object', properties: { inner: { type: 'boolean' } } }] },
                },
            } as unknown as QueryHistoryContext['executions'][number]['schema'];

            const out = service.formatQueryHistoryForLLM({
                databaseId: 'db',
                containerId: 'c',
                executions: [{ query: QUERY_SELECT_ALL, documentCount: 1, schema }],
            });

            expect(out).toContain('"tags": "array<string>"');
            expect(out).toContain('"mixed": "array<string|number>"');
            // union types are emitted as an array of type names
            expect(out).toContain('"union"');
            // object entries recurse into their properties
            expect(out).toContain('"inner"');
        });
    });

    describe('executeOperation - explainQuery happy path', () => {
        it('returns a formatted analysis containing the LLM explanation', async () => {
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));
            callWithTelemetryAndErrorHandling.mockImplementation(async (_name: string, callback: any) =>
                callback({ errorHandling: {}, telemetry: { properties: {}, measurements: {} } }),
            );

            const { QueryEditorTab } = vi.mocked(await import('../panels/QueryEditorTab'));
            (QueryEditorTab.openTabs as any) = new Set(); // no editor → proceed without connection

            const { getSelectedModel } = vi.mocked(await import('../utils/aiUtils'));
            getSelectedModel.mockResolvedValue({} as any);

            const { sendChatRequest } = vi.mocked(await import('./chatUtils'));
            sendChatRequest.mockResolvedValue({
                text: (async function* () {
                    yield 'This query returns all documents.';
                })(),
            } as any);

            const result = await service.executeOperation('explainQuery', {
                currentQuery: QUERY_SELECT_ALL,
                userPrompt: 'explain',
            });

            expect(typeof result).toBe('string');
            expect(result as string).toContain('Query Analysis');
            expect(result as string).toContain('This query returns all documents.');
        });
    });

    describe('executeOperation - editQuery happy path', () => {
        it('returns an EditQueryResult with the suggested and previous queries', async () => {
            const { callWithTelemetryAndErrorHandling } = vi.mocked(await import('@microsoft/vscode-azext-utils'));
            callWithTelemetryAndErrorHandling.mockImplementation(async (_name: string, callback: any) =>
                callback({ errorHandling: {}, telemetry: { properties: {}, measurements: {} } }),
            );

            const mockEditor = {
                getCurrentQueryResults: vi.fn().mockReturnValue({ documents: [{ id: '1' }], requestCharge: 1.5 }),
                getCurrentQuery: vi.fn().mockReturnValue(QUERY_SELECT_ID),
                getSelectedQuery: vi.fn().mockReturnValue(undefined),
                isActive: vi.fn().mockReturnValue(true),
                isVisible: vi.fn().mockReturnValue(true),
            };
            const connection = { databaseId: 'db1', containerId: 'c1', azureMetadata: { accountId: 'acc1' } };

            const { QueryEditorTab } = vi.mocked(await import('../panels/QueryEditorTab'));
            (QueryEditorTab.openTabs as any) = new Set([mockEditor]);
            const { getActiveQueryEditor, getConnectionFromQueryTab, buildChatMessages } = vi.mocked(
                await import('./chatUtils'),
            );
            getActiveQueryEditor.mockReturnValue(mockEditor as any);
            getConnectionFromQueryTab.mockReturnValue(connection as any);
            buildChatMessages.mockReturnValue([] as any);

            const { getSelectedModel, extractJsonObject } = vi.mocked(await import('../utils/aiUtils'));
            const responseJson = JSON.stringify({ query: QUERY_SELECT_ACTIVE, explanation: QUERY_EXPLANATION_ACTIVE });
            const mockStream = (async function* () {
                yield new vscode.LanguageModelTextPart(responseJson);
            })();
            getSelectedModel.mockResolvedValue({
                sendRequest: vi.fn().mockResolvedValue({ stream: mockStream }),
                countTokens: vi.fn().mockResolvedValue(10),
                name: 'm',
                family: 'f',
                id: 'id',
                maxInputTokens: 4096,
            } as any);
            extractJsonObject.mockReturnValue(responseJson);

            const result = await service.executeOperation('editQuery', {
                currentQuery: QUERY_SELECT_ID,
                userPrompt: 'only active rows',
            });

            expect(typeof result).toBe('object');
            const edit = result as Exclude<typeof result, string>;
            expect(edit.type).toBe('editQuery');
            expect(edit.currentQuery).toBe(QUERY_SELECT_ID);
            expect(edit.suggestedQuery).toContain(QUERY_SELECT_ACTIVE);
            expect(edit.suggestedQuery).toContain('Updated from');
            expect(edit.suggestedQuery).toContain('Previous query');
            expect(edit.explanation).toBe(QUERY_EXPLANATION_ACTIVE);
            expect(edit.queryContext.databaseId).toBe('db1');
        });
    });
});
