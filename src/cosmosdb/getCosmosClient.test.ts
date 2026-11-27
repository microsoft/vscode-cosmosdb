/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createHttpHeaders,
    createPipelineRequest,
    type HttpClient,
    type PipelineRequest,
} from '@azure/core-rest-pipeline';
import type * as CosmosSDK from '@azure/cosmos';
import { CosmosClient, type CosmosClientOptions } from '@azure/cosmos';
import { ManagedIdentityCredential } from '@azure/identity';
import { createServer } from 'node:http';
import * as https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { AuthenticationMethod } from './AuthenticationMethod';
import { type CosmosDBCredential } from './CosmosDBCredential';
import { createCosmosHttpClient } from './createCosmosHttpClient';
import { getCosmosClient } from './getCosmosClient';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';
import { getAccessTokenForVSCode } from './utils/azureSessionHelper';
import { withClaimsChallengeHandling } from './withClaimsChallengeHandling';

const mocks = vi.hoisted(() => ({ getManagedToken: vi.fn() }));

vi.mock('@azure/cosmos', async (importOriginal) => ({
    ...(await importOriginal<typeof CosmosSDK>()),
    CosmosClient: vi.fn(function (_options: CosmosClientOptions) {}),
}));
vi.mock('@azure/identity', () => ({
    ManagedIdentityCredential: vi.fn(function () {
        return { getToken: mocks.getManagedToken };
    }),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    appendExtensionUserAgent: () => 'vscode-cosmosdb/1.0.0',
}));
vi.mock('../extensionVariables', () => ({
    ext: {
        settingsKeys: {
            enableEndpointDiscovery: 'discovery',
            cosmosDbAuthentication: 'azureDatabases.cosmosDB.preferredAuthenticationMethod',
        },
        outputChannel: { error: vi.fn() },
    },
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
        mocks.getManagedToken.mockReset().mockResolvedValue(null);
        vi.mocked(getAccessTokenForVSCode).mockReset();
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

    async function useRealSdk() {
        const actual = await vi.importActual<{ CosmosClient: typeof CosmosClient }>('@azure/cosmos');
        vi.mocked(CosmosClient).mockImplementationOnce(function (options) {
            return new actual.CosmosClient(options);
        });
    }

    it('aborts SDK account discovery even when the SDK drops the operation signal', async () => {
        await useRealSdk();
        const controller = new AbortController();
        const entered = Promise.withResolvers<PipelineRequest>();
        const sendRequest = vi.fn<HttpClient['sendRequest']>((request) => {
            entered.resolve({ ...request });
            return new Promise((_resolve, reject) => {
                request.abortSignal?.addEventListener('abort', () => {
                    reject(new DOMException('Cancelled', 'AbortError'));
                });
            });
        });
        const result = withClaimsChallengeHandling(
            connection,
            (client) => client.databases.readAll({ abortSignal: controller.signal }).fetchAll(),
            { abortSignal: controller.signal, httpClient: { sendRequest } },
        );
        const request = await entered.promise;
        expect(new URL(request.url).pathname).toBe('/');

        controller.abort();
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(request.abortSignal?.aborted).toBe(true);
        expect(sendRequest).toHaveBeenCalledOnce();
    });

    it('does not rewrite the supplied transport and restores request signals after success or failure', async () => {
        const controller = new AbortController();
        const requestController = new AbortController();
        const request = createPipelineRequest({
            url: connection.endpoint,
            abortSignal: requestController.signal,
        });
        const response = { request, status: 204, headers: createHttpHeaders() };
        const sendRequest = vi.fn<HttpClient['sendRequest']>().mockResolvedValue(response);
        const httpClient = { sendRequest };
        getCosmosClient(connection, { httpClient, abortSignal: controller.signal });
        const transport = vi.mocked(CosmosClient).mock.calls[0][0].httpClient!;

        await expect(transport.sendRequest(request)).resolves.toBe(response);
        expect(httpClient.sendRequest).toBe(sendRequest);
        expect(sendRequest).toHaveBeenCalledOnce();
        expect(request.abortSignal).toBe(requestController.signal);

        const error = new Error('transport failed');
        sendRequest.mockRejectedValueOnce(error);
        await expect(transport.sendRequest(request)).rejects.toBe(error);
        expect(request.abortSignal).toBe(requestController.signal);
    });

    it('closes an in-flight SDK discovery connection when the operation is aborted', async () => {
        await useRealSdk();
        const controller = new AbortController();
        const entered = Promise.withResolvers<string | undefined>();
        const closed = Promise.withResolvers<void>();
        const server = createServer((request, response) => {
            entered.resolve(request.url);
            response.on('close', () => closed.resolve());
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('Expected a TCP server address');
            }
            const { createDefaultHttpClient } = await import('@azure/core-rest-pipeline');
            const result = withClaimsChallengeHandling(
                { ...connection, endpoint: `http://127.0.0.1:${address.port}` },
                (client) => client.databases.readAll({ abortSignal: controller.signal }).fetchAll(),
                { abortSignal: controller.signal, httpClient: createDefaultHttpClient() },
            );
            expect(await entered.promise).toBe('/');

            controller.abort();
            await expect(result).rejects.toMatchObject({ name: 'AbortError' });
            await closed.promise;
        } finally {
            controller.abort();
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it.each(['client', 'request'])('cancels the transport from the %s signal', async (source) => {
        const controller = new AbortController();
        const requestController = new AbortController();
        const entered = Promise.withResolvers<PipelineRequest['abortSignal']>();
        const completed = Promise.withResolvers<never>();
        const request = createPipelineRequest({
            url: connection.endpoint,
            abortSignal: requestController.signal,
        });
        const sendRequest = vi.fn<HttpClient['sendRequest']>((request) => {
            entered.resolve(request.abortSignal);
            return completed.promise;
        });
        getCosmosClient(connection, { abortSignal: controller.signal, httpClient: { sendRequest } });
        const transport = vi.mocked(CosmosClient).mock.calls[0][0].httpClient!;
        const result = transport.sendRequest(request);
        const signal = await entered.promise;

        (source === 'client' ? controller : requestController).abort();
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(signal?.aborted).toBe(true);
        expect(request.abortSignal).toBe(requestController.signal);
        expect(sendRequest).toHaveBeenCalledOnce();
        completed.reject(new Error('late transport error'));
    });

    it('does not start a cancelled operation', async () => {
        const controller = new AbortController();
        controller.abort();
        const callback = vi.fn();

        await expect(
            withClaimsChallengeHandling(connection, callback, {
                abortSignal: controller.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(callback).not.toHaveBeenCalled();
        expect(CosmosClient).not.toHaveBeenCalled();
    });

    it.each(['resolve', 'reject'])(
        'ignores a late token %s without sending HTTP or trying other credentials',
        async (outcome) => {
            await useRealSdk();
            const controller = new AbortController();
            const entered = Promise.withResolvers<void>();
            const token = Promise.withResolvers<{ token: string; expiresOnTimestamp: number }>();
            vi.mocked(getAccessTokenForVSCode).mockImplementationOnce(async () => {
                entered.resolve();
                return token.promise;
            });
            const sendRequest = vi.fn<HttpClient['sendRequest']>();
            const client = getCosmosClient(
                {
                    ...connection,
                    credentials: [
                        { type: AuthenticationMethod.entraId, tenantId: 'test-tenant' },
                        { type: AuthenticationMethod.managedIdentity, clientId: 'test-client' },
                    ],
                },
                { abortSignal: controller.signal, httpClient: { sendRequest } },
            );
            try {
                const result = client.getDatabaseAccount({ abortSignal: controller.signal });
                await entered.promise;
                controller.abort();
                await expect(result).rejects.toMatchObject({ name: 'AbortError' });

                if (outcome === 'resolve') {
                    token.resolve({ token: 'DUMMY_TOKEN', expiresOnTimestamp: Date.now() + 3600000 });
                } else {
                    token.reject(new Error('AADSTS500011: synthetic token failure'));
                }
                await new Promise<void>((resolve) => setImmediate(resolve));

                expect(getAccessTokenForVSCode).toHaveBeenCalledOnce();
                expect(ManagedIdentityCredential).not.toHaveBeenCalled();
                expect(sendRequest).not.toHaveBeenCalled();
                expect(ext.outputChannel.error).not.toHaveBeenCalled();
            } finally {
                client.dispose();
            }
        },
    );

    it('honors the credential caller signal without a client-scoped signal', async () => {
        const controller = new AbortController();
        const entered = Promise.withResolvers<void>();
        const token = Promise.withResolvers<{ token: string; expiresOnTimestamp: number }>();
        vi.mocked(getAccessTokenForVSCode).mockImplementationOnce(async () => {
            entered.resolve();
            return token.promise;
        });
        getCosmosClient({ ...connection, credentials: [{ type: AuthenticationMethod.entraId, tenantId: 'test' }] });
        const credential = vi.mocked(CosmosClient).mock.calls[0][0].aadCredentials!;
        const result = credential.getToken('scope', { abortSignal: controller.signal });
        await entered.promise;
        controller.abort();

        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        token.resolve({ token: 'DUMMY_TOKEN', expiresOnTimestamp: Date.now() + 3600000 });
    });

    it('forwards token options and cancellation to managed identity', async () => {
        const controller = new AbortController();
        mocks.getManagedToken.mockResolvedValueOnce({ token: 'DUMMY_TOKEN', expiresOnTimestamp: Date.now() + 3600000 });
        getCosmosClient({
            ...connection,
            credentials: [{ type: AuthenticationMethod.managedIdentity, clientId: 'test' }],
        });
        const credential = vi.mocked(CosmosClient).mock.calls[0][0].aadCredentials!;

        await credential.getToken('scope', { abortSignal: controller.signal, claims: 'test-claims' });

        expect(mocks.getManagedToken).toHaveBeenCalledExactlyOnceWith(['scope'], {
            abortSignal: expect.any(AbortSignal),
            claims: 'test-claims',
        });
    });

    it('aborts in-flight managed identity authentication without falling back to Entra ID', async () => {
        const controller = new AbortController();
        const entered = Promise.withResolvers<PipelineRequest['abortSignal']>();
        const token = Promise.withResolvers<never>();
        mocks.getManagedToken.mockImplementationOnce((_scopes, options) => {
            entered.resolve(options.abortSignal);
            return token.promise;
        });
        getCosmosClient(
            {
                ...connection,
                credentials: [
                    { type: AuthenticationMethod.managedIdentity, clientId: 'test-client' },
                    { type: AuthenticationMethod.entraId, tenantId: 'test-tenant' },
                ],
            },
            { abortSignal: controller.signal },
        );
        const credential = vi.mocked(CosmosClient).mock.calls[0][0].aadCredentials!;
        const result = credential.getToken('scope');
        const signal = await entered.promise;
        controller.abort();

        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(signal?.aborted).toBe(true);
        token.reject(new Error('late managed identity failure'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(getAccessTokenForVSCode).not.toHaveBeenCalled();
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
    });

    it('preserves fallback authentication for non-cancellation errors', async () => {
        const token = { token: 'DUMMY_TOKEN', expiresOnTimestamp: Date.now() + 3600000 };
        mocks.getManagedToken.mockRejectedValueOnce(new Error('managed identity unavailable'));
        vi.mocked(getAccessTokenForVSCode).mockResolvedValueOnce(token);
        getCosmosClient({
            ...connection,
            credentials: [
                { type: AuthenticationMethod.managedIdentity, clientId: 'test-client' },
                { type: AuthenticationMethod.entraId, tenantId: 'test-tenant' },
            ],
        });
        const credential = vi.mocked(CosmosClient).mock.calls[0][0].aadCredentials!;

        await expect(credential.getToken('scope')).resolves.toBe(token);
        expect(getAccessTokenForVSCode).toHaveBeenCalledOnce();
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
    });

    it('disables background endpoint refresh only for operation-scoped clients', () => {
        getCosmosClient(connection, { abortSignal: new AbortController().signal });
        getCosmosClient(connection);

        expect(vi.mocked(CosmosClient).mock.calls[0][0].connectionPolicy?.enableBackgroundEndpointRefreshing).toBe(
            false,
        );
        expect(
            vi.mocked(CosmosClient).mock.calls[1][0].connectionPolicy?.enableBackgroundEndpointRefreshing,
        ).toBeUndefined();
    });

    it.each(['success', 'failure', 'abort'] as const)(
        'disposes the operation-scoped client after %s',
        async (outcome) => {
            await useRealSdk();
            const controller = new AbortController();
            const entered = Promise.withResolvers<CosmosClient>();
            const completed = Promise.withResolvers<string>();
            const sendRequest = vi.fn<HttpClient['sendRequest']>();
            const result = withClaimsChallengeHandling(
                connection,
                async (client) => {
                    entered.resolve(client);
                    return completed.promise;
                },
                { abortSignal: controller.signal, httpClient: { sendRequest } },
            );
            const client = await entered.promise;
            const dispose = vi.spyOn(client, 'dispose');
            const error = new Error('request failed');
            const expected = {
                success: { value: 'done' },
                failure: { error },
                abort: { error: expect.objectContaining({ name: 'AbortError' }) },
            }[outcome];
            if (outcome === 'success') {
                completed.resolve('done');
            } else if (outcome === 'failure') {
                completed.reject(error);
            } else {
                controller.abort();
                completed.resolve('late');
            }

            await expect(
                result.then(
                    (value) => ({ value }),
                    (error: unknown) => ({ error }),
                ),
            ).resolves.toEqual(expected);
            expect(dispose).toHaveBeenCalledOnce();
            expect(sendRequest).not.toHaveBeenCalled();
        },
    );
});
