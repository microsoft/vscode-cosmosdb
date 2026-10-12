/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CoreExperience, TableExperience } from '../../../AzureDBExperiences';
import { cosmosDBCreateContainer } from '../../../commands/createContainer/createContainer';
import { cosmosDBCreateDatabase } from '../../../commands/createDatabase/createDatabase';
import { cosmosDBDeleteDatabaseAccount } from '../../../commands/deleteDatabaseAccount/deleteDatabaseAccount';
import { AuthenticationMethod } from '../../../cosmosdb/AuthenticationMethod';
import { type AzureResourceMetadata } from '../../../cosmosdb/AzureResourceMetadata';
import { ext } from '../../../extensionVariables';
import { CosmosDBAccountResourceItem } from '../../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { CosmosDBDatabaseResourceItem } from '../../../tree/cosmosdb/CosmosDBDatabaseResourceItem';
import { accountActionInput, type AccountActionInput } from '../accountActions';
import { buildAccountCostsUrl, runAccountAction } from './accountActions';
import { openAccountJson } from './accountJson';

vi.mock('@vscode/extension-telemetry', () => ({ default: class {} }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));
vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    env: { openExternal: vi.fn() },
}));
vi.mock('../../../commands/createContainer/createContainer', () => ({ cosmosDBCreateContainer: vi.fn() }));
vi.mock('../../../commands/createDatabase/createDatabase', () => ({ cosmosDBCreateDatabase: vi.fn() }));
vi.mock('../../../commands/deleteDatabaseAccount/deleteDatabaseAccount', () => ({
    cosmosDBDeleteDatabaseAccount: vi.fn(),
}));
vi.mock('../../../extensionVariables', () => ({
    ext: { cosmosDBBranchDataProvider: { findNodeById: vi.fn() } },
}));
// Class prototypes keep instanceof meaningful without loading control-plane clients or constructing tree UI.
vi.mock('../../../tree/cosmosdb/CosmosDBAccountResourceItem', () => ({
    CosmosDBAccountResourceItem: class {},
}));
vi.mock('../../../tree/cosmosdb/CosmosDBDatabaseResourceItem', () => ({
    CosmosDBDatabaseResourceItem: class {},
}));
vi.mock('./accountJson', () => ({ openAccountJson: vi.fn() }));

const accountId = '/subscriptions/sub-one/resourceGroups/rg-one/providers/Microsoft.DocumentDB/databaseAccounts/acct';
const tenantId = 'tenant-not-to-mask';
const databaseId = "customer's database";

function metadata(databaseAccount: DatabaseAccountGetResults = {}): AzureResourceMetadata {
    return {
        accountId,
        accountName: 'acct',
        resourceGroup: 'rg-one',
        documentEndpoint: 'https://acct.documents.azure.com:443/',
        subscription: {
            subscriptionId: 'sub-one',
            name: 'Production',
            tenantId,
            environment: { portalUrl: 'https://portal.azure.us/' },
        },
        databaseAccount: { kind: 'GlobalDocumentDB', ...databaseAccount },
    } as AzureResourceMetadata;
}

function actionContext(): IActionContext {
    return {
        valuesToMask: [],
        errorHandling: {},
        telemetry: { properties: {}, measurements: {} },
    } as unknown as IActionContext;
}

function databaseNode() {
    return Object.assign(Object.create(CosmosDBDatabaseResourceItem.prototype) as CosmosDBDatabaseResourceItem, {
        id: `${accountId}/${databaseId}`,
        experience: CoreExperience,
        model: {
            database: { id: databaseId },
            accountInfo: {
                id: accountId,
                endpoint: 'https://data-endpoint.documents.azure.com/',
                credentials: [
                    { type: AuthenticationMethod.accountKey, key: 'secret-account-key' },
                    { type: AuthenticationMethod.managedIdentity, clientId: 'private-client-id' },
                    { type: AuthenticationMethod.entraId, tenantId },
                ],
            },
        },
    });
}

function accountNode(children = [databaseNode()]) {
    return Object.assign(Object.create(CosmosDBAccountResourceItem.prototype) as CosmosDBAccountResourceItem, {
        id: accountId,
        account: { id: accountId },
        experience: CoreExperience,
        getChildren: vi.fn().mockResolvedValue(children),
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(ext.cosmosDBBranchDataProvider.findNodeById).mockResolvedValue(accountNode());
    vi.spyOn(vscode.env, 'openExternal').mockResolvedValue(true);
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);
});

afterEach(() => {
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    vi.restoreAllMocks();
});

describe('runAccountAction', () => {
    it.each([
        [{ action: 'createDatabase' }, cosmosDBCreateDatabase],
        [{ action: 'createContainer', databaseId }, cosmosDBCreateContainer],
        [{ action: 'deleteAccount' }, cosmosDBDeleteDatabaseAccount],
    ] as const)('dispatches %j to its existing handler with the verified node', async (input, handler) => {
        const database = databaseNode();
        const account = accountNode([database]);
        vi.mocked(ext.cosmosDBBranchDataProvider.findNodeById).mockResolvedValue(account);
        const context = actionContext();
        await expect(runAccountAction(context, metadata(), input)).resolves.toEqual({ status: 'completed' });
        expect(ext.cosmosDBBranchDataProvider.findNodeById).toHaveBeenCalledExactlyOnceWith(accountId);
        expect(handler).toHaveBeenCalledExactlyOnceWith(
            context,
            input.action === 'createContainer' ? database : account,
        );
        for (const other of [cosmosDBCreateDatabase, cosmosDBCreateContainer, cosmosDBDeleteDatabaseAccount]) {
            expect(other).toHaveBeenCalledTimes(other === handler ? 1 : 0);
        }
    });

    it('accepts case-insensitive ARM account IDs', async () => {
        const account = accountNode();
        account.id = accountId.toUpperCase();
        account.account.id = accountId.toUpperCase();
        vi.mocked(ext.cosmosDBBranchDataProvider.findNodeById).mockResolvedValue(account);
        await expect(runAccountAction(actionContext(), metadata(), { action: 'createDatabase' })).resolves.toEqual({
            status: 'completed',
        });
    });

    it.each(['missing', 'plain object', 'wrong tree ID', 'wrong account ID'] as const)(
        'rejects %s instead of falling back to an unscoped account picker',
        async (variant) => {
            const account = accountNode();
            if (variant === 'wrong tree ID') {
                account.id = `${accountId}-other`;
            } else if (variant === 'wrong account ID') {
                account.account.id = `${accountId}-other`;
            }
            const resolved =
                variant === 'missing'
                    ? undefined
                    : variant === 'plain object'
                      ? { id: accountId, account: { id: accountId }, experience: CoreExperience }
                      : account;
            vi.mocked(ext.cosmosDBBranchDataProvider.findNodeById).mockResolvedValue(
                resolved as CosmosDBAccountResourceItem | undefined,
            );
            await expect(runAccountAction(actionContext(), metadata(), { action: 'deleteAccount' })).rejects.toThrow(
                'Unable to resolve this account',
            );
            expect(cosmosDBDeleteDatabaseAccount).not.toHaveBeenCalled();
        },
    );

    it.each(['missing', 'plain object', 'wrong database', 'wrong tree ID', 'wrong account', 'wrong API'] as const)(
        'rejects a %s database without invoking Create Container',
        async (variant) => {
            const database = databaseNode();
            if (variant === 'wrong database') {
                database.model.database.id = 'other-db';
            } else if (variant === 'wrong tree ID') {
                database.id = `${accountId}/other-db`;
            } else if (variant === 'wrong account') {
                database.model.accountInfo.id = `${accountId}-other`;
            } else if (variant === 'wrong API') {
                database.experience = TableExperience;
            }
            const children =
                variant === 'missing' ? [] : variant === 'plain object' ? [Object.assign({}, database)] : [database];
            vi.mocked(ext.cosmosDBBranchDataProvider.findNodeById).mockResolvedValue(accountNode(children));
            await expect(
                runAccountAction(actionContext(), metadata(), { action: 'createContainer', databaseId }),
            ).rejects.toThrow('Unable to resolve the selected database');
            expect(cosmosDBCreateContainer).not.toHaveBeenCalled();
        },
    );

    it.each([
        { kind: 'MongoDB', capabilities: [] },
        { kind: 'GlobalDocumentDB', capabilities: [{ name: 'EnableTable' }] },
        { kind: 'GlobalDocumentDB', capabilities: [{ name: 'EnableGremlin' }] },
        { kind: 'GlobalDocumentDB', capabilities: [{ name: 'EnableCassandra' }] },
        { kind: undefined },
    ])('rejects non-NoSQL metadata before resolving a tree node: %j', async (account) => {
        for (const input of [
            { action: 'createDatabase' },
            { action: 'createContainer', databaseId },
        ] satisfies AccountActionInput[]) {
            await expect(runAccountAction(actionContext(), metadata(account), input)).rejects.toThrow(
                'only supported for NoSQL',
            );
        }
        expect(ext.cosmosDBBranchDataProvider.findNodeById).not.toHaveBeenCalled();
        expect(cosmosDBCreateDatabase).not.toHaveBeenCalled();
        expect(cosmosDBCreateContainer).not.toHaveBeenCalled();
    });

    it('rejects a non-NoSQL resolved account even when ARM metadata says NoSQL', async () => {
        const account = accountNode();
        account.experience = TableExperience;
        vi.mocked(ext.cosmosDBBranchDataProvider.findNodeById).mockResolvedValue(account);
        await expect(runAccountAction(actionContext(), metadata(), { action: 'createDatabase' })).rejects.toThrow(
            'only supported for NoSQL',
        );
        expect(cosmosDBCreateDatabase).not.toHaveBeenCalled();
    });

    it('allows Delete on a verified non-NoSQL account', async () => {
        const account = accountNode();
        account.experience = TableExperience;
        vi.mocked(ext.cosmosDBBranchDataProvider.findNodeById).mockResolvedValue(account);
        await expect(
            runAccountAction(actionContext(), metadata({ kind: 'MongoDB' }), { action: 'deleteAccount' }),
        ).resolves.toEqual({ status: 'completed' });
        expect(cosmosDBDeleteDatabaseAccount).toHaveBeenCalledOnce();
    });

    it('does not report Delete completed before its existing handler finishes', async () => {
        let finish!: () => void;
        const deletion = new Promise<void>((resolve) => {
            finish = resolve;
        });
        vi.mocked(cosmosDBDeleteDatabaseAccount).mockReturnValueOnce(deletion);
        const settled = vi.fn();
        const action = runAccountAction(actionContext(), metadata(), { action: 'deleteAccount' }).then(settled);
        await vi.waitFor(() => expect(cosmosDBDeleteDatabaseAccount).toHaveBeenCalledOnce());
        expect(settled).not.toHaveBeenCalled();
        finish();
        await action;
        expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 'completed' });
    });

    it.each([
        [{ action: 'createDatabase' }, cosmosDBCreateDatabase],
        [{ action: 'createContainer', databaseId }, cosmosDBCreateContainer],
        [{ action: 'deleteAccount' }, cosmosDBDeleteDatabaseAccount],
        [{ action: 'openJson' }, openAccountJson],
    ] as const)('distinguishes cancellation from ordinary failure for %j', async (input, handler) => {
        const context = actionContext();
        vi.mocked(handler).mockRejectedValueOnce(new UserCancelledError());
        await expect(runAccountAction(context, metadata(), input)).resolves.toEqual({ status: 'cancelled' });
        expect(context.telemetry.properties).toEqual({ result: 'Canceled' });
        const failure = new Error('ordinary failure');
        vi.mocked(handler).mockRejectedValueOnce(failure);
        const failureContext = actionContext();
        await expect(runAccountAction(failureContext, metadata(), input)).rejects.toBe(failure);
        expect(failureContext.telemetry.properties).toEqual({});
    });

    it('registers error-path masks before tree lookup without explicitly masking the tenant', async () => {
        const context = actionContext();
        const failure = new Error('lookup failed');
        vi.mocked(ext.cosmosDBBranchDataProvider.findNodeById).mockImplementationOnce(async () => {
            expect(context.errorHandling.suppressDisplay).toBe(true);
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([
                    accountId,
                    encodeURIComponent(accountId),
                    'acct',
                    'rg-one',
                    'sub-one',
                    'Production',
                    'acct.documents.azure.com',
                    databaseId,
                    "customer''s database",
                    'customer%27s%20database',
                ]),
            );
            expect(context.valuesToMask).not.toContain(tenantId);
            throw failure;
        });
        await expect(runAccountAction(context, metadata(), { action: 'createContainer', databaseId })).rejects.toBe(
            failure,
        );
        expect(context.telemetry.properties).toEqual({});
        expect(context.telemetry.measurements).toEqual({});
    });

    it('masks database credentials before invoking the container handler', async () => {
        const context = actionContext();
        vi.mocked(cosmosDBCreateContainer).mockImplementationOnce(async () => {
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([
                    'secret-account-key',
                    'private-client-id',
                    'https://data-endpoint.documents.azure.com/',
                    databaseId,
                ]),
            );
            expect(context.valuesToMask).not.toContain(tenantId);
            throw new Error('container failed');
        });
        await expect(runAccountAction(context, metadata(), { action: 'createContainer', databaseId })).rejects.toThrow(
            'container failed',
        );
        expect(context.telemetry.properties).toEqual({});
    });

    it('dispatches JSON without resolving a tree node', async () => {
        const context = actionContext();
        const resource = metadata();
        await expect(runAccountAction(context, resource, { action: 'openJson' })).resolves.toEqual({
            status: 'completed',
        });
        expect(openAccountJson).toHaveBeenCalledExactlyOnceWith(context, resource);
        expect(ext.cosmosDBBranchDataProvider.findNodeById).not.toHaveBeenCalled();
    });

    it('opens costs in the metadata sovereign portal and rejects a refused browser launch', async () => {
        await expect(runAccountAction(actionContext(), metadata(), { action: 'openCosts' })).resolves.toEqual({
            status: 'completed',
        });
        const uri = vi.mocked(vscode.env.openExternal).mock.calls[0][0];
        expect(uri).toEqual(vscode.Uri.parse(buildAccountCostsUrl('https://portal.azure.us/', tenantId, accountId)));
        expect(ext.cosmosDBBranchDataProvider.findNodeById).not.toHaveBeenCalled();
        vi.mocked(vscode.env.openExternal).mockResolvedValueOnce(false);
        await expect(runAccountAction(actionContext(), metadata(), { action: 'openCosts' })).rejects.toThrow(
            'Unable to open account costs',
        );
    });
});

describe('account action boundaries', () => {
    it.each(['https://portal.azure.us/', 'https://portal.azure.cn', 'https://portal.azure.com/'])(
        'encodes the tenant and complete ARM scope for %s',
        (portal) => {
            expect(buildAccountCostsUrl(portal, 'tenant/# ?@', '/subscriptions/sub/rg/a b?#%')).toBe(
                `${portal.replace(/\/$/, '')}/#@tenant%2F%23%20%3F%40/view/Microsoft_Azure_CostManagement/CostAnalysis/scope/%2Fsubscriptions%2Fsub%2Frg%2Fa%20b%3F%23%25`,
            );
        },
    );

    it.each(['', 'db/other', 'db\\other', 'db?other', 'db#other'])('rejects invalid database ID %j', (id) => {
        expect(accountActionInput.safeParse({ action: 'createContainer', databaseId: id }).success).toBe(false);
    });

    it('rejects an unknown action and a missing database target', () => {
        expect(accountActionInput.safeParse({ action: 'executeCommand' }).success).toBe(false);
        expect(accountActionInput.safeParse({ action: 'createContainer' }).success).toBe(false);
        expect(accountActionInput.parse({ action: 'createContainer', databaseId })).toEqual({
            action: 'createContainer',
            databaseId,
        });
    });
});
