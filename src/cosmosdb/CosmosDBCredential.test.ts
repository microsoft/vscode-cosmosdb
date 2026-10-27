/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ext } from '../extensionVariables';
import type * as AuthenticationMethods from './AuthenticationMethod';
import { AuthenticationMethod } from './AuthenticationMethod';
import { getCosmosDBCredentials } from './CosmosDBCredential';
import { getCosmosClient } from './getCosmosClient';

const mocks = vi.hoisted(() => ({
    getDatabaseAccount: vi.fn(),
    dispose: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (_event: string, callback: (context: unknown) => Promise<unknown>) =>
        callback({ telemetry: { properties: {}, measurements: {} }, valuesToMask: [] }),
    parseError: (error: Error) => error,
}));
vi.mock('../extensionVariables', () => ({
    ext: {
        settingsKeys: { connectionTimeout: 'cosmosDB.connectionTimeout' },
        outputChannel: { appendLog: vi.fn(), warn: vi.fn(), show: vi.fn() },
    },
}));
vi.mock('./getCosmosClient', () => ({
    getCosmosClient: vi.fn(() => mocks),
}));
vi.mock('./utils/managedIdentityUtils', () => ({ getManagedIdentityAuth: async () => undefined }));
vi.mock('./AuthenticationMethod', async (importOriginal) => ({
    ...(await importOriginal<typeof AuthenticationMethods>()),
    getPreferredAuthenticationMethod: () => 'accountKey',
}));

const params = {
    accountName: 'test-account',
    documentEndpoint: 'https://account.example.com',
    isEmulator: false,
    masterKey: 'test-key',
};
const keyCredential = { type: AuthenticationMethod.accountKey, key: params.masterKey };

describe('Credential verification cancellation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getDatabaseAccount.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each(['success', 'failure'])('disposes the verification client after %s', async (outcome) => {
        if (outcome === 'success') {
            mocks.getDatabaseAccount.mockResolvedValueOnce({});
        } else {
            mocks.getDatabaseAccount.mockRejectedValueOnce(new Error('connection failed'));
        }

        await expect(getCosmosDBCredentials(params)).resolves.toContainEqual(keyCredential);

        const options = vi.mocked(getCosmosClient).mock.calls[0][3];
        expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
        expect(options?.abortSignal?.aborted).toBe(false);
        expect(mocks.getDatabaseAccount).toHaveBeenCalledExactlyOnceWith({ abortSignal: options?.abortSignal });
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });

    it.each(['resolve', 'reject'])('aborts and disposes a timed-out verification before a late %s', async (outcome) => {
        vi.useFakeTimers();
        const completed = Promise.withResolvers<unknown>();
        mocks.getDatabaseAccount.mockReturnValueOnce(completed.promise);
        const settled = vi.fn();
        const result = getCosmosDBCredentials(params);
        void result.then(settled, settled);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(settled).not.toHaveBeenCalled();
        const options = vi.mocked(getCosmosClient).mock.calls[0][3];
        expect(options?.abortSignal?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toContainEqual(keyCredential);
        expect(options?.abortSignal?.aborted).toBe(true);
        expect(mocks.dispose).toHaveBeenCalledOnce();
        expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(
            expect.stringContaining('Credential verification timed out'),
        );

        if (outcome === 'resolve') {
            completed.resolve({});
        } else {
            completed.reject(new Error('late verification failure'));
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });
});
