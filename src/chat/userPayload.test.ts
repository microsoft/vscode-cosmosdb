/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { type QueryHistoryContext } from './CosmosDbOperationsService';
import {
    buildExplanationContextInfo,
    buildExplanationUserContent,
    buildIntentExtractionUserContent,
    buildParameterExtractionUserContent,
    buildQueryGenerationUserContent,
    formatConnectionContext,
    formatQueryHistoryContext,
    formatResultContext,
    USER_CONTEXT_END,
    USER_CONTEXT_START,
    USER_DATA_END,
    USER_DATA_START,
    USER_QUERY_END,
    USER_QUERY_START,
    wrapUserContent,
    type ConnectionContext,
    type QueryGenerationPayload,
} from './userPayload';

describe('userPayload', () => {
    describe('wrapUserContent', () => {
        it('should wrap data type with USER_DATA delimiters', () => {
            const result = wrapUserContent('hello', 'data');

            expect(result).toBe(`${USER_DATA_START}\nhello\n${USER_DATA_END}`);
        });

        it('should wrap query type with USER_QUERY delimiters', () => {
            const result = wrapUserContent('SELECT * FROM c', 'query');

            expect(result).toBe(`${USER_QUERY_START}\nSELECT * FROM c\n${USER_QUERY_END}`);
        });

        it('should wrap context type with USER_CONTEXT delimiters', () => {
            const result = wrapUserContent('some context', 'context');

            expect(result).toBe(`${USER_CONTEXT_START}\nsome context\n${USER_CONTEXT_END}`);
        });

        it('should default to data type when no type specified', () => {
            const result = wrapUserContent('default content');

            expect(result).toBe(`${USER_DATA_START}\ndefault content\n${USER_DATA_END}`);
        });
    });

    describe('formatConnectionContext', () => {
        it('should format database and container IDs', () => {
            const connection: ConnectionContext = {
                accountId: 'myAccount',
                databaseId: 'myDb',
                containerId: 'myContainer',
            };

            const result = formatConnectionContext(connection);

            expect(result).toContain('myDb');
            expect(result).toContain('myContainer');
        });
    });

    describe('formatResultContext', () => {
        it('should format document count', () => {
            const result = formatResultContext({ documentCount: 42 });

            expect(result).toContain('42');
        });

        it('should format document count and request charge together', () => {
            const result = formatResultContext({ documentCount: 10, requestCharge: 3.14 });

            expect(result).toContain('10');
            expect(result).toContain('3.14');
        });

        it('should format schema when provided', () => {
            const result = formatResultContext({
                schema: { type: 'object', properties: { name: { type: 'string' } } },
            });

            expect(result).toContain('Schema');
        });

        it('should return empty string when no context provided', () => {
            const result = formatResultContext({});

            expect(result).toBe('');
        });
    });

    describe('formatQueryHistoryContext', () => {
        it('should return empty string for undefined input', () => {
            const result = formatQueryHistoryContext(undefined as unknown as QueryHistoryContext);

            expect(result).toBe('');
        });

        it('should return empty string for empty executions', () => {
            const result = formatQueryHistoryContext({
                databaseId: 'db1',
                containerId: 'c1',
                executions: [],
            });

            expect(result).toBe('');
        });

        it('should format query execution history', () => {
            const history: QueryHistoryContext = {
                databaseId: 'testDb',
                containerId: 'testContainer',
                executions: [
                    {
                        query: 'SELECT * FROM c',
                        documentCount: 5,
                        requestCharge: 2.5,
                    },
                ],
            };

            const result = formatQueryHistoryContext(history);

            expect(result).toContain('testDb');
            expect(result).toContain('testContainer');
            expect(result).toContain('SELECT * FROM c');
            expect(result).toContain('5');
            expect(result).toContain('2.50');
        });

        it('should format multiple executions', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'container',
                executions: [
                    { query: 'SELECT * FROM c', documentCount: 10 },
                    { query: 'SELECT c.name FROM c', documentCount: 3, requestCharge: 1.0 },
                ],
            };

            const result = formatQueryHistoryContext(history);

            expect(result).toContain('Query 1');
            expect(result).toContain('Query 2');
            expect(result).toContain('SELECT * FROM c');
            expect(result).toContain('SELECT c.name FROM c');
        });

        it('should include simplified schema when available', () => {
            const history: QueryHistoryContext = {
                databaseId: 'db',
                containerId: 'container',
                executions: [
                    {
                        query: 'SELECT * FROM c',
                        documentCount: 1,
                        simplifiedSchema: { id: 'string', name: 'string' },
                    },
                ],
            };

            const result = formatQueryHistoryContext(history);

            expect(result).toContain('Schema');
            expect(result).toContain('"id"');
            expect(result).toContain('"name"');
        });
    });

    describe('buildExplanationContextInfo', () => {
        it('should include connection info', () => {
            const connection: ConnectionContext = {
                accountId: 'acc',
                databaseId: 'db1',
                containerId: 'c1',
            };

            const result = buildExplanationContextInfo(connection);

            expect(result).toContain('db1');
            expect(result).toContain('c1');
        });

        it('should include result context when provided', () => {
            const connection: ConnectionContext = {
                accountId: 'acc',
                databaseId: 'db1',
                containerId: 'c1',
            };

            const result = buildExplanationContextInfo(connection, {
                documentCount: 15,
                requestCharge: 4.2,
            });

            expect(result).toContain('15');
            expect(result).toContain('4.20');
        });
    });

    describe('buildQueryGenerationUserContent', () => {
        it('should include user prompt wrapped as data', () => {
            const payload: QueryGenerationPayload = {
                userPrompt: 'find all users',
            };

            const result = buildQueryGenerationUserContent(payload);

            expect(result).toContain(USER_DATA_START);
            expect(result).toContain('find all users');
            expect(result).toContain(USER_DATA_END);
        });

        it('should include schema context placeholder when no history', () => {
            const payload: QueryGenerationPayload = {
                userPrompt: 'test',
            };

            const result = buildQueryGenerationUserContent(payload);

            expect(result).toContain('No known schema');
            expect(result).toContain('cosmosdb_sampleContainerSchema');
        });

        it('should include history context when provided', () => {
            const payload: QueryGenerationPayload = {
                userPrompt: 'test',
                historyContext: {
                    databaseId: 'db',
                    containerId: 'c',
                    executions: [{ query: 'SELECT * FROM c', documentCount: 5 }],
                },
            };

            const result = buildQueryGenerationUserContent(payload);

            expect(result).toContain(USER_CONTEXT_START);
            expect(result).toContain('SELECT * FROM c');
        });

        it('should include current query when provided', () => {
            const payload: QueryGenerationPayload = {
                userPrompt: 'modify this query',
                currentQuery: 'SELECT c.id FROM c',
            };

            const result = buildQueryGenerationUserContent(payload);

            expect(result).toContain(USER_QUERY_START);
            expect(result).toContain('SELECT c.id FROM c');
        });

        it('should include cached schema when provided', () => {
            const payload: QueryGenerationPayload = {
                userPrompt: 'test',
                cachedSchema: '{"id": "string", "name": "string"}',
            };

            const result = buildQueryGenerationUserContent(payload);

            expect(result).toContain('Saved Container Schema');
            expect(result).toContain('"id"');
        });

        it('should include additional context when provided', () => {
            const payload: QueryGenerationPayload = {
                userPrompt: 'test',
                additionalContext: 'The container uses partition key /category',
            };

            const result = buildQueryGenerationUserContent(payload);

            expect(result).toContain('User-Provided Context');
            expect(result).toContain('partition key /category');
        });

        it('should always include sample tool reminder', () => {
            const payload: QueryGenerationPayload = {
                userPrompt: 'test',
            };

            const result = buildQueryGenerationUserContent(payload);

            expect(result).toContain('IMPORTANT');
            expect(result).toContain('cosmosdb_sampleContainerSchema');
        });
    });

    describe('buildExplanationUserContent', () => {
        it('should include query wrapped with query delimiters', () => {
            const result = buildExplanationUserContent({
                query: 'SELECT * FROM c WHERE c.active = true',
                userPrompt: 'explain this',
                connection: { accountId: 'acc', databaseId: 'db', containerId: 'c' },
            });

            expect(result).toContain(USER_QUERY_START);
            expect(result).toContain('SELECT * FROM c WHERE c.active = true');
            expect(result).toContain(USER_QUERY_END);
        });

        it('should include user prompt wrapped with data delimiters', () => {
            const result = buildExplanationUserContent({
                query: 'SELECT * FROM c',
                userPrompt: 'what does this do?',
                connection: { accountId: 'acc', databaseId: 'db', containerId: 'c' },
            });

            expect(result).toContain(USER_DATA_START);
            expect(result).toContain('what does this do?');
            expect(result).toContain(USER_DATA_END);
        });
    });

    describe('buildIntentExtractionUserContent', () => {
        it('should wrap user prompt in data delimiters', () => {
            const result = buildIntentExtractionUserContent({
                userPrompt: 'show me all active users',
            });

            expect(result).toContain(USER_DATA_START);
            expect(result).toContain('show me all active users');
            expect(result).toContain(USER_DATA_END);
            expect(result).toContain('User request:');
        });
    });

    describe('buildParameterExtractionUserContent', () => {
        it('should wrap user prompt in data delimiters', () => {
            const result = buildParameterExtractionUserContent('editQuery', 'change filter to active');

            expect(result).toContain(USER_DATA_START);
            expect(result).toContain('change filter to active');
            expect(result).toContain(USER_DATA_END);
            expect(result).toContain('User request:');
        });
    });
});
