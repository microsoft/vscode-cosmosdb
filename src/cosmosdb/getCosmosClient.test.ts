/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, type CosmosClientOptions } from '@azure/cosmos';
import * as https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthenticationMethod } from './AuthenticationMethod';
import { type CosmosDBCredential } from './CosmosDBCredential';
import { createCosmosHttpClient } from './createCosmosHttpClient';
import { getCosmosClient } from './getCosmosClient';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';

vi.mock('@azure/cosmos', () => ({
    CosmosClient: vi.fn(function (_options: CosmosClientOptions) {}),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    appendExtensionUserAgent: () => 'vscode-cosmosdb/1.0.0',
}));
vi.mock('../extensionVariables', () => ({
    ext: { settingsKeys: { enableEndpointDiscovery: 'discovery' } },
}));
vi.mock('./CosmosDBCredential', () => ({
    getCosmosDBKeyCredential: (credentials: CosmosDBCredential[]) =>
        credentials.find((credential) => credential.type === AuthenticationMethod.accountKey),
}));
vi.mock('./NoSqlQueryConnection', () => ({
    isNoSqlQueryConnection: (value: object) => 'databaseId' in value,
}));
vi.mock('./utils/azureSessionHelper', () => ({ getAccessTokenForVSCode: vi.fn() }));
vi.mock('./createCosmosHttpClient', { spy: true });

const connection: NoSqlQueryConnection = {
    endpoint: 'https://account.example.com',
    databaseId: 'database',
    containerId: 'container',
    credentials: [{ type: AuthenticationMethod.accountKey, key: 'test-key' }],
    isEmulator: false,
};

describe('Cosmos client transport configuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        for (const [options] of vi.mocked(CosmosClient).mock.calls) {
            options.agent?.destroy();
        }
        vi.restoreAllMocks();
    });

    it('preserves an explicitly supplied HTTP client', () => {
        const httpClient = { sendRequest: vi.fn() };
        getCosmosClient(connection, { httpClient });

        expect(vi.mocked(CosmosClient).mock.calls[0][0].httpClient).toBe(httpClient);
        expect(createCosmosHttpClient).not.toHaveBeenCalled();
    });

    it.each([
        'https://localhost:8081',
        'https://127.0.0.1:8081',
        'https://[::1]:8081',
        'https://remote-emulator.example.com:8081',
    ])('preserves the existing emulator TLS agent for %s', (endpoint) => {
        getCosmosClient({ ...connection, endpoint, isEmulator: true });

        const options = vi.mocked(CosmosClient).mock.calls[0][0];
        expect(options.agent).toBeInstanceOf(https.Agent);
        expect(options.agent).toMatchObject({ options: { rejectUnauthorized: false } });
        expect(options.httpClient).toBeUndefined();
        expect(createCosmosHttpClient).not.toHaveBeenCalled();
    });

    it('defers agent selection to VS Code for non-emulators', () => {
        getCosmosClient(connection);

        expect(createCosmosHttpClient).toHaveBeenCalledExactlyOnceWith(true);
        const options = vi.mocked(CosmosClient).mock.calls[0][0];
        expect(options.agent).toBeUndefined();
        expect(options.httpClient).toEqual({ sendRequest: expect.any(Function) });
    });

    it.each([true, false, undefined])('honors http.proxyStrictSSL=%s', (strictSSL) => {
        const configuration = vscode.workspace.getConfiguration('http');
        vi.spyOn(configuration, 'get').mockImplementation((key) => (key === 'proxyStrictSSL' ? strictSSL : undefined));
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(configuration);

        getCosmosClient(connection);

        expect(createCosmosHttpClient).toHaveBeenCalledExactlyOnceWith(strictSSL !== false);
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('http');
    });

    it('preserves an explicitly supplied agent instead of overriding it', () => {
        const agent = new https.Agent({ keepAlive: true });
        try {
            getCosmosClient(connection, { agent });

            const options = vi.mocked(CosmosClient).mock.calls[0][0];
            expect(options.agent).toBe(agent);
            expect(options.httpClient).toBeUndefined();
            expect(createCosmosHttpClient).not.toHaveBeenCalled();
        } finally {
            agent.destroy();
        }
    });
});
