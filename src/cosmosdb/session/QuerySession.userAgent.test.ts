/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, type CosmosClientOptions } from '@azure/cosmos';
import type * as Cosmos from '@azure/cosmos';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod } from '../AuthenticationMethod';
import { type CosmosDBCredential } from '../CosmosDBCredential';
import { getCosmosClient } from '../getCosmosClient';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';
import { QuerySession } from './QuerySession';

const mocks = vi.hoisted(() => ({
    fetchNext: vi.fn(),
    fetchAll: vi.fn(),
    query: vi.fn(),
}));

vi.mock('@azure/cosmos', async (importOriginal) => ({
    ...(await importOriginal<typeof Cosmos>()),
    CosmosClient: vi.fn(function (_options: CosmosClientOptions) {
        return { database: () => ({ container: () => ({ items: { query: mocks.query } }) }) };
    }),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    appendExtensionUserAgent: () => 'vscode-cosmosdb/1.0.0',
    callWithTelemetryAndErrorHandling: vi.fn(async (_event: string, callback: (context: unknown) => Promise<unknown>) =>
        callback({
            errorHandling: {},
            telemetry: { measurements: {}, properties: {} },
            valuesToMask: [],
        }),
    ),
}));
vi.mock('../../extensionVariables', () => ({
    ext: {
        settingsKeys: { enableEndpointDiscovery: 'discovery' },
        outputChannel: { error: vi.fn() },
    },
}));
vi.mock('../../chat', () => ({
    CosmosDbOperationsService: { getInstance: () => ({ recordQueryExecution: vi.fn() }) },
}));
vi.mock('../CosmosDBCredential', () => ({
    getCosmosDBKeyCredential: (credentials: CosmosDBCredential[]) =>
        credentials.find((credential) => credential.type === AuthenticationMethod.accountKey),
}));
vi.mock('../NoSqlQueryConnection', () => ({
    isNoSqlQueryConnection: (value: object) => 'databaseId' in value,
}));
vi.mock('../utils/azureSessionHelper', () => ({ getAccessTokenForVSCode: vi.fn() }));

const connection: NoSqlQueryConnection = {
    endpoint: 'https://localhost:8081',
    databaseId: 'database',
    containerId: 'container',
    credentials: [{ type: AuthenticationMethod.accountKey, key: 'test-key' }],
    isEmulator: true,
};

describe('query execution user agent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const response = {
            resources: [],
            queryMetrics: {},
            requestCharge: 1,
            hasMoreResults: true,
        };
        mocks.fetchNext.mockResolvedValue(response);
        mocks.fetchAll.mockResolvedValue(response);
        mocks.query.mockReturnValue({ fetchNext: mocks.fetchNext, fetchAll: mocks.fetchAll });
    });

    it('keeps the default user agent for regular SDK clients', () => {
        getCosmosClient(connection);

        expect(CosmosClient).toHaveBeenCalledWith(
            expect.objectContaining({ userAgentSuffix: 'vscode-cosmosdb/1.0.0' }),
        );
    });

    it('adds the marker without forwarding the extension-only option or changing authentication', () => {
        const options = { isLlmTool: true, throughputBucket: 2 };
        getCosmosClient(connection, options);
        getCosmosClient(connection, options);
        getCosmosClient(connection);

        const calls = vi.mocked(CosmosClient).mock.calls;
        expect(calls[0][0]).toMatchObject({
            userAgentSuffix: 'vscode-cosmosdb/1.0.0/llm-tool',
            key: 'test-key',
            throughputBucket: 2,
        });
        expect(calls[0][0]).not.toHaveProperty('isLlmTool');
        expect(calls[1][0]).toMatchObject({
            userAgentSuffix: 'vscode-cosmosdb/1.0.0/llm-tool',
            key: 'test-key',
            throughputBucket: 2,
        });
        expect(calls[2][0]).toMatchObject({ userAgentSuffix: 'vscode-cosmosdb/1.0.0' });
        expect(options).toEqual({ isLlmTool: true, throughputBucket: 2 });
    });

    it('preserves the default user agent for regular query sessions', async () => {
        const session = new QuerySession(connection, 'SELECT * FROM c', {});
        const result = await session.run();

        expect(result.error).toBeUndefined();
        expect(CosmosClient).toHaveBeenCalledWith(
            expect.objectContaining({ userAgentSuffix: 'vscode-cosmosdb/1.0.0' }),
        );
    });

    it('retains tool attribution across pagination without affecting a later manual run', async () => {
        const toolSession = new QuerySession(connection, 'SELECT * FROM c', { timeout: 5000 }, true);
        expect((await toolSession.run()).error).toBeUndefined();
        expect((await toolSession.nextPage()).error).toBeUndefined();
        expect(mocks.fetchNext).toHaveBeenCalledTimes(2);
        expect(CosmosClient).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                userAgentSuffix: 'vscode-cosmosdb/1.0.0/llm-tool',
                connectionPolicy: expect.objectContaining({ requestTimeout: 5000 }),
            }),
        );

        const userSession = new QuerySession(connection, 'SELECT * FROM c', {});
        expect((await userSession.run()).error).toBeUndefined();
        expect(CosmosClient).toHaveBeenLastCalledWith(
            expect.objectContaining({ userAgentSuffix: 'vscode-cosmosdb/1.0.0' }),
        );
    });

    it('also tags fetch-all tool sessions', async () => {
        const session = new QuerySession(connection, 'SELECT * FROM c', { countPerPage: -1 }, true);
        expect((await session.run()).error).toBeUndefined();
        expect(mocks.fetchAll).toHaveBeenCalledOnce();
        expect(CosmosClient).toHaveBeenCalledWith(
            expect.objectContaining({ userAgentSuffix: 'vscode-cosmosdb/1.0.0/llm-tool' }),
        );
    });
});
