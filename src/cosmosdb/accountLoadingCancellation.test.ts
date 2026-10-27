/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CoreExperience } from '../AzureDBExperiences';
import { BaseCachedBranchDataProvider } from '../tree/BaseCachedBranchDataProvider';
import { type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { CosmosDBAccountResourceItem } from '../tree/cosmosdb/CosmosDBAccountResourceItem';
import { type CosmosDBAccountModel } from '../tree/cosmosdb/models/CosmosDBAccountModel';
import { type DatabaseResource } from '../tree/cosmosdb/models/CosmosDBTypes';
import { type TreeElement } from '../tree/TreeElement';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { armTestSubscription, createArmTestClient, createArmTestContext } from './armTestUtils';

vi.mock('../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));
vi.mock('../constants', () => ({ getThemeAgnosticIconURI: () => undefined, CosmosDBTimeouts: {} }));
vi.mock('../extensionVariables', () => ({
    ext: {
        state: { wrapItemInStateHandling: (item: TreeElement) => item },
        outputChannel: { warn: vi.fn(), show: vi.fn() },
        settingsKeys: { cosmosDbAuthentication: 'cosmosDB.preferredAuthentication' },
    },
}));
vi.mock('../services/FabricService', () => ({ FabricService: { isArtifact: () => false } }));
vi.mock('./controlPlane', () => ({ getControlPlane: vi.fn() }));
vi.mock('./utils/rbacUtils', () => ({}));
vi.mock('./utils/azureSessionHelper', () => ({}));
vi.mock('./utils/managedIdentityUtils', () => ({ getManagedIdentityAuth: async () => undefined }));
vi.mock('./getCosmosClient', () => ({ getCosmosClient: vi.fn() }));
vi.mock('./AuthenticationMethod', () => ({
    AuthenticationMethod: {
        auto: 'auto',
        accountKey: 'accountKey',
        entraId: 'entraId',
        managedIdentity: 'managedIdentity',
    },
    getPreferredAuthenticationMethod: () => 'auto',
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class extends Error {
        _isUserCancelledError = true;
    },
    callWithTelemetryAndErrorHandling: async (_event: string, callback: (context: IActionContext) => unknown) => {
        const context = createArmTestContext();
        try {
            return await callback(context);
        } catch (error) {
            // The real SDK consumes cancellation even when rethrow is requested.
            if (
                error instanceof vscode.CancellationError ||
                (typeof error === 'object' && error !== null && '_isUserCancelledError' in error)
            ) {
                return undefined;
            }
            if (context.errorHandling.rethrow) {
                throw error;
            }
            return undefined;
        }
    },
    callWithTelemetryAndErrorHandlingSync: (_event: string, callback: (context: IActionContext) => unknown) =>
        callback(createArmTestContext()),
    parseError: (error: unknown) => ({
        message: error instanceof Error ? error.message : String(error),
        isUserCancelledError:
            error instanceof vscode.CancellationError ||
            (typeof error === 'object' && error !== null && '_isUserCancelledError' in error),
    }),
    createGenericElement: (options: { id: string; label: string }) => ({
        id: options.id,
        getTreeItem: () => ({ label: options.label }),
    }),
}));

const account: CosmosDBAccountModel = {
    id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account',
    name: 'account',
    type: 'Microsoft.DocumentDB/databaseAccounts',
    resourceGroup: 'rg',
    subscription: armTestSubscription,
    azureResourceType: { type: 'microsoft.documentdb/databaseaccounts' },
    raw: {},
};

class TestAccount extends CosmosDBAccountResourceItem {
    public databaseReads = 0;

    constructor(model: CosmosDBAccountModel) {
        super(model, CoreExperience);
    }

    protected override getDatabases(_info: AccountInfo): Promise<DatabaseResource[]> {
        this.databaseReads++;
        return Promise.resolve([]);
    }

    protected getChildrenImpl(): Promise<TreeElement[]> {
        return Promise.resolve([]);
    }
}

class TestProvider extends BaseCachedBranchDataProvider<CosmosDBAccountModel> {
    protected readonly providerName = 'AccountLoadingTest';
    protected readonly contextValue = 'test';

    protected createResourceItem(_context: IActionContext, model: CosmosDBAccountModel): TestAccount {
        return new TestAccount(model);
    }
}

describe('explicit account loading cancellation', () => {
    let client: ReturnType<typeof createArmTestClient>;

    beforeEach(() => {
        vi.restoreAllMocks();
        client = createArmTestClient();
        vi.mocked(createCosmosDBManagementClient).mockReset().mockResolvedValue(client);
        vi.spyOn(client.databaseAccounts, 'get').mockResolvedValue({
            documentEndpoint: 'https://account.documents.azure.com',
        });
        vi.spyOn(client.databaseAccounts, 'listKeys').mockResolvedValue({ primaryMasterKey: 'test-key' });
    });

    for (const stage of ['metadata client', 'metadata request', 'credential client', 'key request']) {
        for (const kind of ['user', 'VS Code']) {
            it(`preserves ${kind} cancellation during ${stage}`, async () => {
                const error = kind === 'user' ? new UserCancelledError() : new vscode.CancellationError();
                if (stage === 'metadata client') {
                    vi.mocked(createCosmosDBManagementClient).mockRejectedValueOnce(error);
                } else if (stage === 'metadata request') {
                    vi.mocked(client.databaseAccounts.get).mockRejectedValueOnce(error);
                } else if (stage === 'credential client') {
                    vi.mocked(createCosmosDBManagementClient)
                        .mockResolvedValueOnce(client)
                        .mockRejectedValueOnce(error);
                } else {
                    vi.mocked(client.databaseAccounts.listKeys).mockRejectedValueOnce(error);
                }

                const provider = new TestProvider();
                const node = await provider.getResourceItem(account);
                await expect(provider.getChildren(node, { propagateErrors: true })).rejects.toBe(error);
                await expect(provider.getChildren(node, { propagateErrors: true })).resolves.toEqual([]);
            });
        }
    }

    for (const stage of ['metadata client', 'metadata request']) {
        it(`preserves ordinary errors during ${stage}`, async () => {
            const error = new Error('Metadata loading failed');
            if (stage === 'metadata client') {
                vi.mocked(createCosmosDBManagementClient).mockRejectedValueOnce(error);
            } else {
                vi.mocked(client.databaseAccounts.get).mockRejectedValueOnce(error);
            }
            const provider = new TestProvider();
            const node = await provider.getResourceItem(account);
            await expect(provider.getChildren(node, { propagateErrors: true })).rejects.toBe(error);
        });

        it(`keeps the normal browsing error node after ${stage} cancellation`, async () => {
            const error = new UserCancelledError();
            if (stage === 'metadata client') {
                vi.mocked(createCosmosDBManagementClient).mockRejectedValueOnce(error);
            } else {
                vi.mocked(client.databaseAccounts.get).mockRejectedValueOnce(error);
            }
            const provider = new TestProvider();
            const node = await provider.getResourceItem(account);
            const children = await provider.getChildren(node);
            expect(children).toHaveLength(1);
            expect((await children[0].getTreeItem()).label).toContain('Failed to connect to Cosmos DB account');
        });
    }

    it('does not turn ordinary key-auth fallback into an explicit loading failure', async () => {
        vi.mocked(client.databaseAccounts.listKeys).mockRejectedValueOnce(new Error('Key access unavailable'));
        const provider = new TestProvider();
        const node = await provider.getResourceItem(account);
        await expect(provider.getChildren(node, { propagateErrors: true })).resolves.toEqual([]);
    });
});
