/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import manifest from '../../../package.json';
import labels from '../../../package.nls.json';
import {
    CassandraExperience,
    CoreExperience,
    FabricNativeExperience,
    GremlinExperience,
    TableExperience,
} from '../../AzureDBExperiences';
import { armTestSubscription, createArmTestContext } from '../../cosmosdb/armTestUtils';
import { CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { CosmosDBAccountUnsupportedResourceItem } from '../../tree/cosmosdb/CosmosDBAccountUnsupportedResourceItem';
import { type CosmosDBAccountModel } from '../../tree/cosmosdb/models/CosmosDBAccountModel';
import { NoSqlAccountResourceItem } from '../../tree/nosql/NoSqlAccountResourceItem';
import { openInDatabaseHub } from './openInDatabaseHub';

vi.mock('vscode', () => ({
    env: { openExternal: vi.fn() },
    Uri: { parse: vi.fn((url: string) => ({ toString: () => url })) },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
    ThemeIcon: class {},
}));
vi.mock('../../cosmosdb/AzureResourceMetadata', () => ({ AzureResourceMetadata: class {} }));
vi.mock('../../constants', () => ({ getThemeAgnosticIconURI: () => new vscode.ThemeIcon('database') }));
vi.mock('../../cosmosdb/controlPlane', () => ({ getControlPlane: vi.fn() }));
vi.mock('../../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBEntraIdCredential: vi.fn() }));
vi.mock('../../cosmosdb/utils/azureSessionHelper', () => ({ getSignedInPrincipalIdForAccountEndpoint: vi.fn() }));
vi.mock('../../cosmosdb/utils/rbacUtils', () => ({
    ensureRbacPermissionV2: vi.fn(),
    isRbacException: vi.fn(),
    showRbacPermissionError: vi.fn(),
}));
vi.mock('../../tree/cosmosdb/AccountInfo', () => ({ getAccountInfo: vi.fn() }));
vi.mock('../../tree/nosql/NoSqlDatabaseResourceItem', () => ({ NoSqlDatabaseResourceItem: vi.fn() }));

function createAccount(
    environmentName: string = Environment.AzureCloud.name,
    isCustomCloud = false,
): CosmosDBAccountModel {
    return {
        id: '/subscriptions/sub-1/resourceGroups/group/providers/Microsoft.DocumentDB/databaseAccounts/account',
        name: 'account',
        type: 'Microsoft.DocumentDB/databaseAccounts',
        azureResourceType: { type: 'microsoft.documentdb/databaseaccounts' },
        resourceGroup: 'group',
        raw: {},
        subscription: {
            ...armTestSubscription,
            isCustomCloud,
            environment: { ...armTestSubscription.environment, name: environmentName },
        },
    };
}

function createNode(account = createAccount()) {
    const contextValue = 'treeItem.account;experience.Core;hasArmMetadata;supportsDatabaseHub';
    return {
        id: account.id,
        account,
        contextValue,
        getTreeItem: () => ({ contextValue }),
    };
}

class WorkspaceAccount extends CosmosDBAccountResourceItemBase {
    constructor() {
        super({ id: 'attached-account', name: 'Attached account' }, CoreExperience);
    }

    public getConnectionString(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
}

const menu = manifest.contributes.menus['view/item/context'].find(
    (entry) => 'command' in entry && entry.command === 'cosmosDB.openInDatabaseHub',
)!;

function isMenuVisible(node: { getTreeItem(): vscode.TreeItem }, view: string): boolean {
    const contextValue = node.getTreeItem().contextValue ?? '';
    return menu.when.split(' && ').every((condition) => {
        const match = /^(view|viewItem) =~ \/(.*)\/(i?)$/.exec(condition);
        if (!match) {
            throw new Error(`Unexpected menu condition: ${condition}`);
        }
        return new RegExp(match[2], match[3]).test(match[1] === 'view' ? view : contextValue);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.env.openExternal).mockResolvedValue(true);
});

describe('Database Hub account menu', () => {
    it('uses the Portal label, sits after Open in Portal, and stays out of the Command Palette', () => {
        const command = manifest.contributes.commands.find((entry) => entry.command === 'cosmosDB.openInDatabaseHub');
        expect(command?.title).toBe('%cosmosdb.command.account.databaseHub.open%');
        expect(labels['cosmosdb.command.account.databaseHub.open']).toBe('View in Database Hub');
        expect(menu.group).toBe('9@3');
        expect(
            manifest.contributes.menus.commandPalette.find((entry) => entry.command === 'cosmosDB.openInDatabaseHub'),
        ).toEqual({ command: 'cosmosDB.openInDatabaseHub', when: 'never' });
        expect(readFileSync(resolve(__dirname, '..', 'registerCommands.ts'), 'utf8')).toContain(
            "registerCommandWithTreeNodeUnwrapping('cosmosDB.openInDatabaseHub', openInDatabaseHub)",
        );
    });

    it.each(['azureResourceGroups', 'azureFocusView'])('shows public NoSQL accounts in %s', (view) => {
        const node = new NoSqlAccountResourceItem(createAccount(), CoreExperience);
        expect(node.supportsDatabaseHub).toBe(true);
        expect(isMenuVisible(node, view)).toBe(true);
        expect(node.contextValue).toContain('hasArmMetadata');
        expect(node.contextValue).toContain('experience.Core');
    });

    it.each(['azureWorkspace', 'vscode-fabric.view.workspace'])('hides even public Azure nodes in %s', (view) => {
        expect(isMenuVisible(new NoSqlAccountResourceItem(createAccount(), CoreExperience), view)).toBe(false);
    });

    it.each(['AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud', 'UnknownCloud'])(
        'hides and rejects accounts in %s',
        async (environmentName) => {
            const node = new NoSqlAccountResourceItem(createAccount(environmentName), CoreExperience);
            expect(node.supportsDatabaseHub).toBe(false);
            expect(isMenuVisible(node, 'azureResourceGroups')).toBe(false);
            await expect(openInDatabaseHub(createArmTestContext(), node)).rejects.toThrow('public Azure');
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
        },
    );

    it('uses the public environment name regardless of isCustomCloud', async () => {
        const node = new NoSqlAccountResourceItem(createAccount(Environment.AzureCloud.name, true), CoreExperience);
        expect(node.supportsDatabaseHub).toBe(true);
        expect(isMenuVisible(node, 'azureResourceGroups')).toBe(true);
        await openInDatabaseHub(createArmTestContext(), node);
        expect(vscode.env.openExternal).toHaveBeenCalledOnce();
    });

    it.each([TableExperience, GremlinExperience, CassandraExperience, FabricNativeExperience])(
        'hides and rejects the $api API',
        async (experience) => {
            const node = new NoSqlAccountResourceItem(createAccount(), experience);
            expect(isMenuVisible(node, 'azureResourceGroups')).toBe(false);
            await expect(openInDatabaseHub(createArmTestContext(), node)).rejects.toThrow('NoSQL');
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
        },
    );

    it.each([new WorkspaceAccount(), new CosmosDBAccountUnsupportedResourceItem(createAccount(), CoreExperience)])(
        'hides and rejects attached or unsupported account nodes',
        async (node) => {
            expect(isMenuVisible(node, 'azureResourceGroups')).toBe(false);
            await expect(openInDatabaseHub(createArmTestContext(), node)).rejects.toThrow('NoSQL');
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
        },
    );
});

describe('openInDatabaseHub', () => {
    it('opens the Portal estate route with only the account ARM ID and database type, masking before browser access', async () => {
        const node = createNode();
        const context = createArmTestContext();
        vi.mocked(vscode.env.openExternal).mockImplementationOnce(async (uri) => {
            const url = new URL(uri.toString());
            expect(url.origin).toBe('https://app.fabric.microsoft.com');
            expect(url.pathname).toBe('/workloads/fdh/databaseHub/estate');
            expect([...url.searchParams]).toEqual([
                ['databaseType', 'cosmos-db'],
                ['databaseResourceId', node.account.id],
            ]);
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([
                    node.account.id,
                    node.account.name,
                    node.account.resourceGroup,
                    node.account.subscription.subscriptionId,
                    encodeURIComponent(node.account.id),
                    url.toString(),
                ]),
            );
            return true;
        });

        await openInDatabaseHub(context, node);

        expect(vscode.env.openExternal).toHaveBeenCalledOnce();
        expect(context.telemetry.properties).toEqual({});
        expect(context.telemetry.measurements).toEqual({});
        expect(context.valuesToMask.every((value) => value.trim().length > 0)).toBe(true);
    });

    it('safely encodes account IDs instead of allowing extra query parameters', async () => {
        const account = { ...createAccount(), id: `${createAccount().id} &extra=value#fragment` };
        await openInDatabaseHub(createArmTestContext(), createNode(account));
        const url = new URL(vi.mocked(vscode.env.openExternal).mock.calls[0][0].toString());
        expect(url.searchParams.get('databaseResourceId')).toBe(account.id);
        expect(url.searchParams.has('extra')).toBe(false);
        expect(url.hash).toBe('');
    });

    it('rejects a missing selection instead of opening an unscoped Hub', async () => {
        await expect(openInDatabaseHub(createArmTestContext())).rejects.toThrow('NoSQL');
        expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });

    it('rejects a node without context information', async () => {
        const node = { id: 'other-node', getTreeItem: () => ({}) };
        await expect(openInDatabaseHub(createArmTestContext(), node)).rejects.toThrow('NoSQL');
        expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });

    it('uses the context marker instead of a supportsDatabaseHub property', async () => {
        const node = {
            ...createNode(),
            contextValue: 'treeItem.account;experience.Core;hasArmMetadata',
            supportsDatabaseHub: true,
        };
        await expect(openInDatabaseHub(createArmTestContext(), node)).rejects.toThrow('NoSQL');
        expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });

    it('requires the exact support marker, not a similarly named context value', async () => {
        const node = { ...createNode(), contextValue: 'treeItem.account;supportsDatabaseHubDisabled' };
        await expect(openInDatabaseHub(createArmTestContext(), node)).rejects.toThrow('NoSQL');
        expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });

    it('rejects an empty ARM ID', async () => {
        const node = createNode({ ...createAccount(), id: '' });
        await expect(openInDatabaseHub(createArmTestContext(), node)).rejects.toThrow('account.id');
        expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });

    it('reports a refused browser launch', async () => {
        vi.mocked(vscode.env.openExternal).mockResolvedValueOnce(false);
        await expect(openInDatabaseHub(createArmTestContext(), createNode())).rejects.toThrow(
            'Unable to open the link in your browser.',
        );
    });

    it('propagates browser errors through the registered command error handler', async () => {
        const error = new Error('Browser failed');
        vi.mocked(vscode.env.openExternal).mockRejectedValueOnce(error);
        await expect(openInDatabaseHub(createArmTestContext(), createNode())).rejects.toBe(error);
    });
});
