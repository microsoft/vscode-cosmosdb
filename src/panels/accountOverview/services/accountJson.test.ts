/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../../../cosmosdb/AzureResourceMetadata';
import { createCosmosDBManagementClient } from '../../../utils/azureClients';
import { openAccountJson } from './accountJson';

vi.mock('@vscode/extension-telemetry', () => ({ default: class {} }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));
vi.mock('../../../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));

const accountId =
    '/subscriptions/private-sub/resourceGroups/private-rg/providers/Microsoft.DocumentDB/databaseAccounts/private-acct';
const metadata = {
    accountId,
    accountName: 'private-acct',
    resourceGroup: 'private-rg',
    documentEndpoint: 'https://private-acct.documents.azure.com/',
    subscription: { subscriptionId: 'private-sub', name: 'Private subscription', tenantId: 'unmasked-tenant' },
    databaseAccount: { id: accountId, name: 'private-acct', kind: 'GlobalDocumentDB' },
} as AzureResourceMetadata;

const get = vi.fn<CosmosDBManagementClient['databaseAccounts']['get']>();
const listKeys = vi.fn();
const listReadOnlyKeys = vi.fn();
const listConnectionStrings = vi.fn();
const client = {
    databaseAccounts: { get, listKeys, listReadOnlyKeys, listConnectionStrings },
} as unknown as CosmosDBManagementClient;

function actionContext(): IActionContext {
    return {
        valuesToMask: [],
        errorHandling: {},
        telemetry: { properties: {}, measurements: {} },
    } as unknown as IActionContext;
}

function respondWith(body: string | null | undefined): void {
    get.mockImplementationOnce(async (_group, _name, options) => {
        // The onResponse contract is all this fixture needs from the HTTP pipeline.
        options?.onResponse?.({ bodyAsText: body } as Parameters<NonNullable<typeof options.onResponse>>[0]);
        return { id: 'flattened-sdk-id', name: 'flattened-sdk-name', documentEndpoint: 'flattened-endpoint' };
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createCosmosDBManagementClient).mockResolvedValue(client);
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as vscode.TextDocument);
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({} as vscode.TextEditor);
});

afterEach(() => vi.restoreAllMocks());

describe('openAccountJson', () => {
    it('opens the original ARM envelope with unmodeled fields, not the flattened SDK result, and never lists keys', async () => {
        const raw = {
            id: accountId,
            name: 'private-acct',
            type: 'Microsoft.DocumentDB/databaseAccounts',
            location: 'westus',
            tags: { owner: 'private-owner' },
            identity: { type: 'SystemAssigned', principalId: 'private-principal', tenantId: 'unmasked-tenant' },
            properties: {
                documentEndpoint: metadata.documentEndpoint,
                databaseAccountOfferType: 'Standard',
                futureApiField: { nested: [0, false, null, 'private-value'] },
            },
            futureEnvelopeField: { enabled: true },
        };
        respondWith(JSON.stringify(raw));
        const document = { uri: vscode.Uri.parse('untitled:account.json') } as vscode.TextDocument;
        vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
        const context = actionContext();

        await openAccountJson(context, metadata);

        expect(createCosmosDBManagementClient).toHaveBeenCalledExactlyOnceWith(context, metadata.subscription);
        expect(get).toHaveBeenCalledExactlyOnceWith('private-rg', 'private-acct', {
            onResponse: expect.any(Function),
        });
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledExactlyOnceWith({
            language: 'json',
            content: JSON.stringify(raw, undefined, 2),
        });
        expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(document);
        expect(listKeys).not.toHaveBeenCalled();
        expect(listReadOnlyKeys).not.toHaveBeenCalled();
        expect(listConnectionStrings).not.toHaveBeenCalled();
        expect(context.telemetry.properties).toEqual({});
        expect(context.telemetry.measurements).toEqual({});
    });

    it.each([undefined, null, ''])(
        'rejects a missing raw ARM body (%j), without using the SDK projection',
        async (body) => {
            respondWith(body);
            await expect(openAccountJson(actionContext(), metadata)).rejects.toThrow('empty account response');
            expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
            expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
        },
    );

    it('does not expose malformed response content through the error or its cause', async () => {
        respondWith('{"private-owner-secret": invalid JSON');
        const context = actionContext();
        const error = await openAccountJson(context, metadata).catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Azure Resource Manager returned invalid account JSON.');
        expect((error as Error).cause).toBeUndefined();
        expect(String(error)).not.toContain('private-owner-secret');
        expect(context.telemetry.properties).toEqual({});
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it.each([false, true])('sanitizes SDK failures even when onResponse ran: %s', async (responseReceived) => {
        const sensitive = new Error('private-tag-value in SDK deserialization body', {
            cause: new Error('private-nested-cause'),
        });
        get.mockImplementationOnce(async (_group, _name, options) => {
            if (responseReceived) {
                options?.onResponse?.({ bodyAsText: '{"tag":"private-tag-value"}' } as Parameters<
                    NonNullable<typeof options.onResponse>
                >[0]);
            }
            throw sensitive;
        });
        const context = actionContext();
        const error = await openAccountJson(context, metadata).catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBe(sensitive);
        expect((error as Error).message).toBe('Unable to retrieve account JSON from Azure Resource Manager.');
        expect((error as Error).cause).toBeUndefined();
        expect(String(error)).not.toContain('private-tag-value');
        expect(context.telemetry.properties).toEqual({});
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('masks account identity before client creation but does not explicitly mask tenant IDs', async () => {
        const context = actionContext();
        const failure = new Error('authentication failed');
        vi.mocked(createCosmosDBManagementClient).mockImplementationOnce(async () => {
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([
                    accountId,
                    encodeURIComponent(accountId),
                    'private-acct',
                    'private-rg',
                    'private-sub',
                    'Private subscription',
                    'private-acct.documents.azure.com',
                ]),
            );
            expect(context.valuesToMask).not.toContain('unmasked-tenant');
            throw failure;
        });
        await expect(openAccountJson(context, metadata)).rejects.toBe(failure);
        expect(get).not.toHaveBeenCalled();
    });

    it.each(['client', 'get', 'open document', 'show document'] as const)(
        'preserves UserCancelledError from %s',
        async (stage) => {
            const cancelled = new UserCancelledError();
            respondWith('{"properties":{}}');
            if (stage === 'client') {
                vi.mocked(createCosmosDBManagementClient).mockRejectedValueOnce(cancelled);
            } else if (stage === 'get') {
                get.mockReset().mockRejectedValueOnce(cancelled);
            } else if (stage === 'open document') {
                vi.mocked(vscode.workspace.openTextDocument).mockRejectedValueOnce(cancelled);
            } else {
                vi.mocked(vscode.window.showTextDocument).mockRejectedValueOnce(cancelled);
            }
            await expect(openAccountJson(actionContext(), metadata)).rejects.toBe(cancelled);
        },
    );

    it.each(['open document', 'show document'] as const)('propagates ordinary %s failures', async (stage) => {
        respondWith('{"properties":{}}');
        const failure = new Error('editor failed');
        if (stage === 'open document') {
            vi.mocked(vscode.workspace.openTextDocument).mockRejectedValueOnce(failure);
        } else {
            vi.mocked(vscode.window.showTextDocument).mockRejectedValueOnce(failure);
        }
        await expect(openAccountJson(actionContext(), metadata)).rejects.toBe(failure);
    });
});
