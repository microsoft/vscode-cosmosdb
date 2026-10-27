/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isUserCancelledError, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createArmTestContext } from './cosmosdb/armTestUtils';
import { type TreeElement } from './tree/TreeElement';
import { globalUriHandler, revealAzureResourceInExplorer } from './vscodeUriHandler';

const mocks = vi.hoisted(() => ({
    reveal: vi.fn<(id: string, options?: unknown) => Promise<{ id: string; resource?: TreeElement } | undefined>>(),
    legacyReveal: vi.fn<(id: string, options?: unknown) => Promise<void>>(),
    selected: vi.fn<() => Promise<string | undefined>>(),
    findNode: vi.fn(),
    context: undefined as IActionContext | undefined,
    supportsResult: true,
}));

vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    TelemetryTrustedValue: class {
        constructor(public value: string) {}
    },
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (_name: string, action: (context: IActionContext) => Promise<void>) =>
        action(mocks.context!),
    UserCancelledError: class extends Error {
        _isUserCancelledError = true;
    },
    isUserCancelledError: (error: unknown) =>
        !!error &&
        typeof error === 'object' &&
        '_isUserCancelledError' in error &&
        error._isUserCancelledError === true,
}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    parseAzureResourceId: (rawId: string) => ({
        rawId,
        subscriptionId: rawId.split('/')[2],
        resourceGroup: rawId.split('/')[4],
        provider: rawId.split('/').slice(6, 8).join('/'),
        resourceName: rawId.split('/')[8],
    }),
}));
vi.mock('./extensionVariables', () => {
    const resources = {
        get revealAzureResourceWithResult() {
            return mocks.supportsResult ? mocks.reveal : undefined;
        },
        revealAzureResource: mocks.legacyReveal,
        getSelectedAzureNode: mocks.selected,
    };
    return {
        ext: {
            rgApiV2: { resources },
            rgApiV2Ready: Promise.resolve({ resources }),
            cosmosDBBranchDataProvider: { findNodeById: mocks.findNode },
        },
    };
});
vi.mock('./commands/openNoSqlQueryEditor/openNoSqlQueryEditor', () => ({ openNoSqlQueryEditor: vi.fn() }));
vi.mock('./services/StorageService', () => ({ StorageNames: {}, StorageService: {} }));
vi.mock('./tree/cosmosdb/AccountInfo', () => ({ getAccountInfo: vi.fn() }));
vi.mock('./utils/dialogs/getConfirmation', () => ({ getConfirmationAsInSettings: vi.fn() }));
vi.mock('./cosmosdb/cosmosDBConnectionStrings', () => ({
    parseCosmosDBConnectionString: () => ({ accountName: 'account', tenantId: undefined }),
}));

const accountId =
    '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account';
const tenantId = '22222222-2222-2222-2222-222222222222';
const prefix = `/accounts/account-id/tenants/${tenantId}`;
const parsedId = {
    rawId: accountId,
    subscriptionId: '11111111-1111-1111-1111-111111111111',
    resourceGroup: 'rg',
    provider: 'Microsoft.DocumentDB/databaseAccounts',
    resourceName: 'account',
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.supportsResult = true;
    mocks.context = createArmTestContext();
    mocks.reveal.mockImplementation(async (id) => ({ id: prefix + id, resource: { id, getTreeItem: () => ({}) } }));
    mocks.legacyReveal.mockResolvedValue(undefined);
    mocks.findNode.mockImplementation(async (id: string) => ({ id }));
    mocks.selected.mockResolvedValue('/previously-selected-resource');
    vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_options, task) =>
        task({ report: vi.fn() }, new vscode.CancellationTokenSource().token),
    );
});

describe('Azure resource URI handling', () => {
    it.each(['resourceId', 'connectionString'])(
        'registers standalone ARM identifiers before %s reveal failure',
        async (kind) => {
            let masksAtReveal: string[] | undefined;
            mocks.reveal.mockImplementationOnce(async () => {
                masksAtReveal = [...(mocks.context?.valuesToMask ?? [])];
                throw new Error('Cannot load account in rg');
            });
            const params: Record<string, string> =
                kind === 'resourceId'
                    ? { resourceId: accountId }
                    : {
                          cs: 'AccountEndpoint=https://account.documents.azure.com;AccountKey=unused;',
                          subscriptionId: parsedId.subscriptionId,
                          resourceGroup: parsedId.resourceGroup,
                      };

            await expect(
                globalUriHandler(
                    vscode.Uri.parse(`vscode://ms-azuretools.vscode-cosmosdb?${new URLSearchParams(params)}`),
                ),
            ).rejects.toThrow('Cannot load account in rg');
            expect(masksAtReveal).toEqual(
                expect.arrayContaining([parsedId.subscriptionId, parsedId.resourceGroup, parsedId.resourceName]),
            );
        },
    );

    it('passes tenantId and the session visibility policy for resource IDs', async () => {
        await globalUriHandler(
            vscode.Uri.parse(
                `vscode://ms-azuretools.vscode-cosmosdb?${new URLSearchParams({ resourceId: accountId, tenantId })}`,
            ),
        );
        expect(mocks.reveal).toHaveBeenCalledWith(accountId, {
            tenantId,
            includeFilteredSubscription: true,
            revealOptions: { select: true, focus: true, expand: true },
        });
        expect(mocks.findNode).not.toHaveBeenCalled();
        expect(mocks.selected).not.toHaveBeenCalled();
    });

    it('also passes tenantId for connection strings that identify an Azure resource', async () => {
        await globalUriHandler(
            vscode.Uri.parse(
                `vscode://ms-azuretools.vscode-cosmosdb?${new URLSearchParams({
                    cs: 'AccountEndpoint=https://account.documents.azure.com/;AccountKey=key',
                    subscriptionId: parsedId.subscriptionId,
                    resourceGroup: 'rg',
                    tenantId,
                })}`,
            ),
        );
        expect(mocks.reveal).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ tenantId, includeFilteredSubscription: true }),
        );
    });

    it('allows links without a tenant hint', async () => {
        await globalUriHandler(
            vscode.Uri.parse(
                `vscode://ms-azuretools.vscode-cosmosdb?${new URLSearchParams({ resourceId: accountId })}`,
            ),
        );
        expect(mocks.reveal).toHaveBeenCalledWith(accountId, expect.objectContaining({ tenantId: undefined }));
    });

    it.each(['', 'not-a-guid', '../another-tenant'])('rejects invalid tenant hints: %s', async (invalidTenantId) => {
        await expect(
            globalUriHandler(
                vscode.Uri.parse(
                    `vscode://ms-azuretools.vscode-cosmosdb?${new URLSearchParams({ resourceId: accountId, tenantId: invalidTenantId })}`,
                ),
            ),
        ).rejects.toThrow('tenantId');
        expect(mocks.reveal).not.toHaveBeenCalled();
    });

    it('resolves the deepest requested node without using the current tree selection', async () => {
        const fullId = `${accountId}/database/container`;
        await revealAzureResourceInExplorer(mocks.context, parsedId, 'database', 'container', {
            tenantId,
            includeFilteredSubscription: true,
        });
        expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(fullId, expect.objectContaining({ tenantId }));
        expect(mocks.findNode).not.toHaveBeenCalled();
        expect(mocks.selected).not.toHaveBeenCalled();
    });

    it('does not open a stale selection after a failed reveal', async () => {
        mocks.reveal.mockRejectedValue(new Error('Resource not found'));
        await expect(revealAzureResourceInExplorer(mocks.context, parsedId)).rejects.toThrow('Resource not found');
        expect(mocks.findNode).not.toHaveBeenCalled();
    });

    it('rejects a result pointing at a different resource', async () => {
        mocks.reveal.mockResolvedValue({ id: prefix + accountId + '-other' });
        await expect(revealAzureResourceInExplorer(mocks.context, parsedId)).rejects.toThrow('Unable to reveal');
        expect(mocks.findNode).not.toHaveBeenCalled();
    });

    describe.each([
        ['result-returning', true],
        ['legacy', false],
    ] as const)('%s reveal target matching', (_name, supportsResult) => {
        beforeEach(() => {
            mocks.supportsResult = supportsResult;
        });

        function setRevealedId(id: string): void {
            mocks.reveal.mockResolvedValue({ id: prefix + id, resource: { id, getTreeItem: () => ({}) } });
            mocks.selected.mockResolvedValue(prefix + id);
        }

        it.each([
            ['Sales', 'items'],
            ['sales', 'Items'],
        ])('rejects case-mismatched database/container IDs: %s/%s', async (database, container) => {
            setRevealedId(`${accountId}/${database}/${container}`);
            await expect(revealAzureResourceInExplorer(mocks.context, parsedId, 'sales', 'items')).rejects.toThrow(
                'Unable to reveal',
            );
            expect(mocks.findNode).not.toHaveBeenCalled();
        });

        it('accepts ARM account casing differences with an exact database/container suffix', async () => {
            const id = `${accountId.toUpperCase()}/sales/items`;
            setRevealedId(id);
            await expect(
                revealAzureResourceInExplorer(mocks.context, parsedId, 'sales', 'items'),
            ).resolves.toMatchObject({
                id,
            });
            expect(mocks.findNode.mock.calls).toEqual(supportsResult ? [] : [[id]]);
        });

        it('accepts ARM casing differences for account-only requests', async () => {
            const id = accountId.toUpperCase();
            setRevealedId(id);
            await expect(revealAzureResourceInExplorer(mocks.context, parsedId)).resolves.toMatchObject({ id });
        });

        it.each([
            ['Sales', 'items'],
            ['sales', 'Items'],
            ['other-sales', 'items'],
        ])('rejects a mismatched resolved node: %s/%s', async (database, container) => {
            setRevealedId(`${accountId}/sales/items`);
            mocks.findNode.mockResolvedValue({ id: `${accountId}/${database}/${container}` });
            if (supportsResult) {
                mocks.reveal.mockResolvedValue({
                    id: prefix + `${accountId}/sales/items`,
                    resource: { id: `${accountId}/${database}/${container}`, getTreeItem: () => ({}) },
                });
            }
            await expect(revealAzureResourceInExplorer(mocks.context, parsedId, 'sales', 'items')).rejects.toThrow(
                'Unable to find database',
            );
        });
    });

    it('uses the exact selected model rather than another identity in the shared cache', async () => {
        const selected: TreeElement = { id: `${accountId}/db/items`, getTreeItem: () => ({}) };
        const otherIdentity: TreeElement = { id: selected.id, getTreeItem: () => ({}) };
        mocks.findNode.mockResolvedValue(otherIdentity);
        mocks.reveal.mockResolvedValue({ id: prefix + selected.id, resource: selected });
        await expect(revealAzureResourceInExplorer(mocks.context, parsedId, 'db', 'items')).resolves.toBe(selected);
        expect(mocks.findNode).not.toHaveBeenCalled();
    });

    it.each([accountId.replace('/rg/', '/tenants/'), accountId.replace(/account$/, 'tenants')])(
        'preserves later tenants path segments: %s',
        async (id) => {
            const parsed = { ...parsedId, rawId: id };
            await expect(revealAzureResourceInExplorer(mocks.context, parsed, 'db', 'items')).resolves.toMatchObject({
                id: `${id}/db/items`,
            });
        },
    );

    it('does not silently fall back to the cache when a modern result lacks a provider model', async () => {
        mocks.reveal.mockResolvedValue({ id: prefix + accountId });
        await expect(revealAzureResourceInExplorer(mocks.context, parsedId)).rejects.toThrow('Unable to find resource');
        expect(mocks.findNode).not.toHaveBeenCalled();
    });

    it('preserves the lightweight reveal path for in-extension callers', async () => {
        await expect(
            revealAzureResourceInExplorer(undefined, parsedId, undefined, undefined, {
                verifyAndResolve: false,
            }),
        ).resolves.toBeUndefined();
        expect(mocks.legacyReveal).toHaveBeenCalledExactlyOnceWith(accountId, {
            select: true,
            focus: true,
            expand: true,
        });
        expect(mocks.reveal).not.toHaveBeenCalled();
        expect(mocks.findNode).not.toHaveBeenCalled();
    });

    it('supports visible resources on older Azure Resources hosts', async () => {
        mocks.supportsResult = false;
        mocks.selected.mockResolvedValue(prefix + accountId);
        await expect(revealAzureResourceInExplorer(mocks.context, parsedId)).resolves.toEqual({ id: accountId });
        expect(mocks.legacyReveal).toHaveBeenCalled();
        expect(mocks.findNode).toHaveBeenCalledWith(accountId);
    });

    it('does not silently ignore tenant hints on older hosts', async () => {
        mocks.supportsResult = false;
        await expect(
            revealAzureResourceInExplorer(mocks.context, parsedId, undefined, undefined, {
                tenantId,
            }),
        ).rejects.toThrow('Update the Azure Resources extension');
        expect(mocks.findNode).not.toHaveBeenCalled();
        expect(mocks.legacyReveal).not.toHaveBeenCalled();
    });

    it('rejects stale selections from older hosts', async () => {
        mocks.supportsResult = false;
        await expect(revealAzureResourceInExplorer(mocks.context, parsedId)).rejects.toThrow('Unable to reveal');
        expect(mocks.findNode).not.toHaveBeenCalled();
    });

    it('treats a cancelled sign-in result as cancellation rather than a URI error', async () => {
        mocks.reveal.mockResolvedValue(undefined);
        const uri = vscode.Uri.parse(
            `vscode://ms-azuretools.vscode-cosmosdb?${new URLSearchParams({ resourceId: accountId, tenantId })}`,
        );
        await expect(globalUriHandler(uri)).rejects.toSatisfy(isUserCancelledError);
        expect(mocks.findNode).not.toHaveBeenCalled();
    });

    it('preserves cancellation errors crossing extension boundaries', async () => {
        const cancellation = new UserCancelledError();
        mocks.reveal.mockRejectedValue(cancellation);
        await expect(
            globalUriHandler(
                vscode.Uri.parse(
                    `vscode://ms-azuretools.vscode-cosmosdb?${new URLSearchParams({ resourceId: accountId })}`,
                ),
            ),
        ).rejects.toBe(cancellation);
    });

    it('preserves VS Code authentication cancellation', async () => {
        const cancellation = new vscode.CancellationError();
        mocks.reveal.mockRejectedValue(cancellation);
        await expect(
            globalUriHandler(
                vscode.Uri.parse(
                    `vscode://ms-azuretools.vscode-cosmosdb?${new URLSearchParams({ resourceId: accountId })}`,
                ),
            ),
        ).rejects.toBe(cancellation);
    });
});
