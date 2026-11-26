/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ManagedIdentityCredential } from '@azure/identity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthenticationMethod } from '../AuthenticationMethod';
import { getManagedIdentityAuth } from './managedIdentityUtils';

const mocks = vi.hoisted(() => ({
    getToken: vi.fn(),
}));

vi.mock('@azure/identity', () => ({
    ManagedIdentityCredential: vi.fn(function () {
        return { getToken: mocks.getToken };
    }),
}));
vi.mock('../../extensionVariables', () => ({
    ext: {
        settingsKeys: { authManagedIdentityClientId: 'azureDatabases.authentication.managedIdentity.clientID' },
        outputChannel: { debug: vi.fn(), error: vi.fn() },
    },
}));

describe('managed identity client ID configuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function configureClientId(clientId: string | null | undefined): void {
        const configuration = vscode.workspace.getConfiguration();
        vi.spyOn(configuration, 'get').mockReturnValue(clientId);
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(configuration);
    }

    it.each([
        { clientId: null, expected: undefined },
        { clientId: undefined, expected: undefined },
        { clientId: 'configured-client', expected: 'configured-client' },
    ])('normalizes the client ID $clientId when managed identity is forced', async ({ clientId, expected }) => {
        configureClientId(clientId);

        await expect(getManagedIdentityAuth('https://account.example.com', true)).resolves.toEqual({
            type: AuthenticationMethod.managedIdentity,
            clientId: expected,
        });
    });

    it('uses system-assigned identity with the null default during automatic detection', async () => {
        configureClientId(null);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiVersions: ['2021-02-01'] }))),
        );
        mocks.getToken.mockResolvedValue({ token: 'test-token', expiresOnTimestamp: 0 });
        const { signal } = new AbortController();

        await expect(getManagedIdentityAuth('https://account.example.com', false, signal)).resolves.toEqual({
            type: AuthenticationMethod.managedIdentity,
            clientId: undefined,
        });

        expect(ManagedIdentityCredential).toHaveBeenCalledWith({ clientId: undefined });
        expect(mocks.getToken).toHaveBeenCalledExactlyOnceWith('https://account.example.com/.default', {
            abortSignal: signal,
        });
    });
});
