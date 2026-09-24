/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { createHttpHeaders, type PipelineRequest } from '@azure/core-rest-pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { openAccountJson } from './accountJson';

vi.mock('vscode', () => ({
    workspace: { openTextDocument: vi.fn() },
    window: { showTextDocument: vi.fn() },
}));

const accountId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account';
const timestamp = '2026-05-14T11:41:11.3992106+00:00';
const armAccount = {
    id: accountId,
    name: 'account',
    type: 'Microsoft.DocumentDB/databaseAccounts',
    location: 'West Europe',
    kind: 'GlobalDocumentDB',
    tags: {},
    systemData: { createdAt: timestamp },
    identity: { type: 'SystemAssigned', principalId: 'principal', tenantId: 'tenant' },
    properties: {
        provisioningState: 'Succeeded',
        documentEndpoint: 'https://account.documents.azure.com:443/',
        databaseAccountOfferType: 'Standard',
        sqlEndpoint: 'https://account.documents.azure.com:443/',
        EnabledApiTypes: 'Sql',
        configurationOverrides: { unmodeledSetting: 'keep' },
        keysMetadata: { primaryMasterKey: { generationTime: timestamp } },
    },
};

function createClient() {
    const sendRequest = vi.fn(async (request: PipelineRequest) => ({
        request,
        status: 200,
        headers: createHttpHeaders({ 'content-type': 'application/json' }),
        bodyAsText: JSON.stringify(armAccount),
    }));
    const client = new CosmosDBManagementClient(
        { getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 60_000 }) },
        'sub',
        { httpClient: { sendRequest }, retryOptions: { maxRetries: 0 } },
    );
    return { client, sendRequest };
}

beforeEach(() => vi.clearAllMocks());

describe('account JSON view', () => {
    it('opens the original ARM shape, unmodeled fields and timestamp strings rather than the SDK model', async () => {
        const { client, sendRequest } = createClient();
        const databaseAccount = await client.databaseAccounts.get('rg', 'account');
        expect(databaseAccount.provisioningState).toBe('Succeeded');
        expect(databaseAccount.systemData?.createdAt).toBeInstanceOf(Date);

        await openAccountJson({
            getClient: async () => client,
            resourceGroup: 'rg',
            accountName: 'account',
        });

        expect(vscode.workspace.openTextDocument).toHaveBeenCalledExactlyOnceWith({
            language: 'json',
            content: JSON.stringify(armAccount, undefined, 2),
        });
        expect(vscode.window.showTextDocument).toHaveBeenCalledOnce();
        expect(sendRequest).toHaveBeenCalledTimes(2);
        expect(sendRequest.mock.calls[1][0].method).toBe('GET');
        expect(new URL(sendRequest.mock.calls[1][0].url).pathname).toBe(accountId);
    });

    it('reads the account again each time JSON view is opened', async () => {
        const { client, sendRequest } = createClient();
        const metadata = { getClient: async () => client, resourceGroup: 'rg', accountName: 'account' };
        await openAccountJson(metadata);
        const updated = { ...armAccount, properties: { ...armAccount.properties, disableLocalAuth: true } };
        sendRequest.mockImplementation(async (request) => ({
            request,
            status: 200,
            headers: createHttpHeaders({ 'content-type': 'application/json' }),
            bodyAsText: JSON.stringify(updated),
        }));
        await openAccountJson(metadata);
        expect(sendRequest).toHaveBeenCalledTimes(2);
        expect(vscode.workspace.openTextDocument).toHaveBeenLastCalledWith({
            language: 'json',
            content: JSON.stringify(updated, undefined, 2),
        });
    });

    it('reports a missing client instead of displaying a cached SDK model', async () => {
        await expect(
            openAccountJson({ getClient: async () => undefined, resourceGroup: 'rg', accountName: 'account' }),
        ).rejects.toThrow('Failed to create CosmosDB management client.');
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it('propagates ARM permission errors without opening an editor', async () => {
        const { client, sendRequest } = createClient();
        sendRequest.mockImplementation(async (request) => ({
            request,
            status: 403,
            headers: createHttpHeaders({ 'content-type': 'application/json' }),
            bodyAsText: JSON.stringify({ error: { code: 'AuthorizationFailed', message: 'Access denied.' } }),
        }));
        await expect(
            openAccountJson({ getClient: async () => client, resourceGroup: 'rg', accountName: 'account' }),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it('rejects an empty ARM body rather than showing an empty document', async () => {
        const { client, sendRequest } = createClient();
        sendRequest.mockImplementation(async (request) => ({
            request,
            status: 200,
            headers: createHttpHeaders({ 'content-type': 'application/json' }),
            bodyAsText: '',
        }));
        await expect(
            openAccountJson({ getClient: async () => client, resourceGroup: 'rg', accountName: 'account' }),
        ).rejects.toThrow('Azure Resource Manager returned an empty account response.');
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });
});
