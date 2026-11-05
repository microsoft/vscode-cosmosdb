/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CosmosDBBranchDataProvider } from '../tree/azure-resources-view/cosmosdb/CosmosDBBranchDataProvider';
import { type CosmosDBAccountModel } from '../tree/cosmosdb/models/CosmosDBAccountModel';
import { type TreeElement } from '../tree/TreeElement';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { armTestSubscription, createArmTestClient, createArmTestContext } from './armTestUtils';

const mocks = vi.hoisted<{
    temporaryChildren: TreeElement[];
    actions: { event: string; context: IActionContext }[];
}>(() => ({ temporaryChildren: [], actions: [] }));

vi.mock('../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    createAuthorizationManagementClient: vi.fn(),
    getResourceGroupFromId: vi.fn(),
}));
vi.mock('../constants', () => ({ getThemeAgnosticIconURI: () => undefined, CosmosDBTimeouts: {} }));
vi.mock('../extensionVariables', () => ({
    ext: {
        state: {
            wrapItemInStateHandling: (item: TreeElement) => {
                const originalGetChildren = item.getChildren?.bind(item);
                if (originalGetChildren) {
                    // Reproduce the SDK state wrapper, which drops arguments and adds temporary UI nodes.
                    item.getChildren = async () => [
                        ...mocks.temporaryChildren,
                        ...((await originalGetChildren()) ?? []),
                    ];
                }
                return item;
            },
        },
        outputChannel: { warn: vi.fn(), show: vi.fn() },
        settingsKeys: { cosmosDbAuthentication: 'cosmosDB.preferredAuthentication' },
    },
}));
vi.mock('../services/FabricService', () => ({ FabricService: { isArtifact: () => false } }));
vi.mock('../services/SchemaService', () => ({ SchemaService: { getInstance: vi.fn() } }));
vi.mock('../utils/survey', () => ({ countExperienceUsageForSurvey: vi.fn() }));
vi.mock('./withClaimsChallengeHandling', () => ({ withClaimsChallengeHandling: vi.fn() }));
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
    callWithTelemetryAndErrorHandling: async (event: string, callback: (context: IActionContext) => unknown) => {
        const context = createArmTestContext();
        mocks.actions.push({ event, context });
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
    tags: { defaultExperience: 'Core (SQL)' },
    raw: {},
};

describe('decorated NoSQL tree loading cancellation', () => {
    let client: ReturnType<typeof createArmTestClient>;
    let databaseIds: string[];
    let containerIds: string[];

    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.temporaryChildren = [];
        mocks.actions = [];
        databaseIds = [];
        containerIds = [];
        client = createArmTestClient();
        vi.mocked(createCosmosDBManagementClient).mockReset().mockResolvedValue(client);
        vi.spyOn(client.databaseAccounts, 'get').mockResolvedValue({
            documentEndpoint: 'https://account.documents.azure.com',
        });
        vi.spyOn(client.databaseAccounts, 'listKeys').mockResolvedValue({ primaryMasterKey: 'test-key' });
        vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_httpClient, request) => ({
            request,
            status: 200,
            headers: createHttpHeaders(),
            bodyAsText: JSON.stringify({
                value: (request.url.includes('/containers') ? containerIds : databaseIds).map((id) => ({
                    name: id,
                    properties: { resource: { id } },
                })),
            }),
        }));
    });

    for (const stage of [
        'metadata client',
        'metadata request',
        'credential client',
        'key request',
        'database client',
    ]) {
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
                } else if (stage === 'database client') {
                    vi.mocked(createCosmosDBManagementClient)
                        .mockResolvedValueOnce(client)
                        .mockResolvedValueOnce(client)
                        .mockRejectedValueOnce(error);
                } else {
                    vi.mocked(client.databaseAccounts.listKeys).mockRejectedValueOnce(error);
                }

                const provider = new CosmosDBBranchDataProvider();
                const node = await provider.getResourceItem(account);
                await expect(provider.getChildren(node, { propagateErrors: true })).rejects.toBe(error);
                await expect(provider.getChildren(node, { propagateErrors: true })).resolves.toEqual([]);
            });
        }
    }

    for (const stage of ['metadata client', 'metadata request', 'database client']) {
        it(`preserves ordinary errors during ${stage}`, async () => {
            const error = new Error('Metadata loading failed');
            if (stage === 'metadata client') {
                vi.mocked(createCosmosDBManagementClient).mockRejectedValueOnce(error);
            } else if (stage === 'metadata request') {
                vi.mocked(client.databaseAccounts.get).mockRejectedValueOnce(error);
            } else {
                vi.mocked(createCosmosDBManagementClient)
                    .mockResolvedValueOnce(client)
                    .mockResolvedValueOnce(client)
                    .mockRejectedValueOnce(error);
            }
            const provider = new CosmosDBBranchDataProvider();
            const node = await provider.getResourceItem(account);
            await expect(provider.getChildren(node, { propagateErrors: true })).rejects.toBe(error);
        });

        it(`keeps the normal browsing error node after ${stage} cancellation`, async () => {
            const error = new UserCancelledError();
            if (stage === 'metadata client') {
                vi.mocked(createCosmosDBManagementClient).mockRejectedValueOnce(error);
            } else if (stage === 'metadata request') {
                vi.mocked(client.databaseAccounts.get).mockRejectedValueOnce(error);
            } else {
                vi.mocked(createCosmosDBManagementClient)
                    .mockResolvedValueOnce(client)
                    .mockResolvedValueOnce(client)
                    .mockRejectedValueOnce(error);
            }
            const provider = new CosmosDBBranchDataProvider();
            const node = await provider.getResourceItem(account);
            const children = await provider.getChildren(node);
            expect(children).toHaveLength(1);
            expect((await children[0].getTreeItem()).label).toContain('Failed to connect to Cosmos DB account');
        });
    }

    it('does not turn ordinary key-auth fallback into an explicit loading failure', async () => {
        vi.mocked(client.databaseAccounts.listKeys).mockRejectedValueOnce(new Error('Key access unavailable'));
        const provider = new CosmosDBBranchDataProvider();
        const node = await provider.getResourceItem(account);
        await expect(provider.getChildren(node, { propagateErrors: true })).resolves.toEqual([]);
    });

    it.each(['user', 'VS Code', 'ordinary'])('preserves %s errors during container client creation', async (kind) => {
        databaseIds = ['db'];
        containerIds = ['items'];
        const provider = new CosmosDBBranchDataProvider();
        const root = await provider.getResourceItem(account);
        const [database] = await provider.getChildren(root, { propagateErrors: true });
        expect(database.id).toBe(`${account.id}/db`);
        const failure =
            kind === 'user'
                ? new UserCancelledError()
                : kind === 'VS Code'
                  ? new vscode.CancellationError()
                  : new Error('Container client failed');
        vi.mocked(createCosmosDBManagementClient).mockRejectedValueOnce(failure);

        await expect(provider.getChildren(database, { propagateErrors: true })).rejects.toBe(failure);
        const containers = await provider.getChildren(database, { propagateErrors: true });
        expect(containers.map((item) => item.id)).toEqual([`${account.id}/db/items`]);
    });

    it('does not retain an explicit policy in the account metadata for subsequent browsing', async () => {
        databaseIds = ['db'];
        const provider = new CosmosDBBranchDataProvider();
        const root = await provider.getResourceItem(account);
        const [database] = await provider.getChildren(root, { propagateErrors: true });
        vi.mocked(createCosmosDBManagementClient).mockRejectedValueOnce(new UserCancelledError());

        const children = await provider.getChildren(database);
        expect(children).toHaveLength(1);
        expect((await children[0].getTreeItem()).label).toContain('Failed to connect to Cosmos DB account');
    });

    it('keeps state-manager temporary children in browsing but excludes them from explicit resolution', async () => {
        const provider = new CosmosDBBranchDataProvider();
        const root = await provider.getResourceItem(account);
        mocks.temporaryChildren = [{ id: 'temporary', getTreeItem: () => ({ label: 'Creating database...' }) }];

        expect((await provider.getChildren(root)).map((item) => item.id)).toEqual(['temporary']);
        await expect(provider.getChildren(root, { propagateErrors: true })).resolves.toEqual([]);
    });

    it('does not add Azure OII masks when metadata loading fails', async () => {
        const provider = new CosmosDBBranchDataProvider();
        const root = await provider.getResourceItem(account);
        const failure = new Error(`Cannot load ${account.name} in ${account.resourceGroup}`);
        let outerMasks: string[] | undefined;
        vi.mocked(client.databaseAccounts.get).mockImplementationOnce(async () => {
            outerMasks = [
                ...(mocks.actions.find((action) => action.event === 'CosmosDBBranchDataProvider.getChildren')?.context
                    .valuesToMask ?? []),
            ];
            throw failure;
        });

        await expect(provider.getChildren(root, { propagateErrors: true })).rejects.toBe(failure);
        expect(outerMasks).toEqual([]);
        const outer = mocks.actions.find((action) => action.event === 'CosmosDBBranchDataProvider.getChildren');
        const inner = mocks.actions.find((action) => action.event === 'cosmosDB.getAzureSpecificMetadata');
        expect(outer?.context).not.toBe(inner?.context);
        expect(inner?.context.valuesToMask).toEqual([]);
    });

    it('registers loaded connection and database identifiers before container loading fails', async () => {
        databaseIds = ['private-database'];
        const provider = new CosmosDBBranchDataProvider();
        const root = await provider.getResourceItem(account);
        const [database] = await provider.getChildren(root, { propagateErrors: true });
        mocks.actions = [];
        const failure = new Error('Container discovery failed');
        let outerMasks: string[] | undefined;
        vi.mocked(createCosmosDBManagementClient).mockImplementationOnce(async () => {
            outerMasks = [
                ...(mocks.actions.find((action) => action.event === 'CosmosDBBranchDataProvider.getChildren')?.context
                    .valuesToMask ?? []),
            ];
            throw failure;
        });

        await expect(provider.getChildren(database, { propagateErrors: true })).rejects.toBe(failure);
        expect(outerMasks).toEqual(
            expect.arrayContaining(['private-database', 'https://account.documents.azure.com', 'test-key']),
        );
        expect(
            outerMasks?.filter((value) =>
                [account.id, account.name, account.resourceGroup, account.subscription.subscriptionId].includes(value),
            ),
        ).toEqual([]);
    });
});
