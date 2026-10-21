/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CoreExperience } from '../../../AzureDBExperiences';
import { cosmosDBCreateContainer, createContainer } from '../../../commands/createContainer/createContainer';
import { cosmosDBCreateDatabase, createDatabase } from '../../../commands/createDatabase/createDatabase';
import { openDataModelingWizard } from '../../../commands/dataModeling/openDataModelingWizard';
import {
    cosmosDBDeleteDatabaseAccount,
    deleteDatabaseAccount,
} from '../../../commands/deleteDatabaseAccount/deleteDatabaseAccount';
import { armTestSubscription, createArmTestContext } from '../../../cosmosdb/armTestUtils';
import { AuthenticationMethod } from '../../../cosmosdb/AuthenticationMethod';
import { AzureResourceMetadata } from '../../../cosmosdb/AzureResourceMetadata';
import { getControlPlane, type CosmosDBControlPlane } from '../../../cosmosdb/controlPlane';
import { getCosmosDBCredentials, type CosmosDBCredential } from '../../../cosmosdb/CosmosDBCredential';
import { createCosmosDBManagementClient } from '../../../utils/azureClients';
import { accountActionInput, type AccountActionInput } from '../accountActions';
import { buildAccountCostsUrl, runAccountAction } from './accountActions';
import { openAccountJson } from './accountJson';

const mocks = vi.hoisted(() => ({ listDatabases: vi.fn<CosmosDBControlPlane['listDatabases']>() }));

vi.mock('@vscode/extension-telemetry', () => ({ default: class {} }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));
vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    env: { openExternal: vi.fn() },
}));
vi.mock('../../../commands/createContainer/createContainer', () => ({
    cosmosDBCreateContainer: vi.fn(),
    createContainer: vi.fn(),
}));
vi.mock('../../../commands/createDatabase/createDatabase', () => ({
    cosmosDBCreateDatabase: vi.fn(),
    createDatabase: vi.fn(),
}));
vi.mock('../../../commands/dataModeling/openDataModelingWizard', () => ({ openDataModelingWizard: vi.fn() }));
vi.mock('../../../commands/deleteDatabaseAccount/deleteDatabaseAccount', () => ({
    cosmosDBDeleteDatabaseAccount: vi.fn(),
    deleteDatabaseAccount: vi.fn(),
}));
vi.mock('../../../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));
vi.mock('../../../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBCredentials: vi.fn() }));
vi.mock('../../../services/FabricService', () => ({ FabricService: {} }));
vi.mock('../../../cosmosdb/controlPlane', () => ({
    getControlPlane: vi.fn(() => ({ listDatabases: mocks.listDatabases })),
}));
vi.mock('../../../extensionVariables', () => ({
    ext: {
        get cosmosDBBranchDataProvider() {
            throw new Error('Account Overview actions must not resolve Explorer nodes.');
        },
    },
}));
vi.mock('./accountJson', () => ({ openAccountJson: vi.fn() }));

const accountId = '/subscriptions/sub-one/resourceGroups/rg-one/providers/Microsoft.DocumentDB/databaseAccounts/acct';
const tenantId = 'tenant-not-to-mask';
const databaseId = "customer's database";
const nonNoSqlAccounts: DatabaseAccountGetResults[] = [
    { kind: 'MongoDB', capabilities: [] },
    { kind: 'GlobalDocumentDB', capabilities: [{ name: 'EnableTable' }] },
    { kind: 'GlobalDocumentDB', capabilities: [{ name: 'EnableGremlin' }] },
    { kind: 'GlobalDocumentDB', capabilities: [{ name: 'EnableCassandra' }] },
    { kind: undefined },
];

class TestMetadata extends AzureResourceMetadata {
    public constructor(databaseAccount: DatabaseAccountGetResults = {}) {
        super(
            {
                ...armTestSubscription,
                subscriptionId: 'sub-one',
                name: 'Production',
                tenantId,
                environment: { ...armTestSubscription.environment, portalUrl: 'https://portal.azure.us/' },
            },
            accountId,
            'acct',
            'rg-one',
            { kind: 'GlobalDocumentDB', documentEndpoint: 'https://acct.documents.azure.com:443/', ...databaseAccount },
        );
    }
}

function metadata(databaseAccount: DatabaseAccountGetResults = {}): AzureResourceMetadata {
    return new TestMetadata(databaseAccount);
}

function actionContext() {
    const context = createArmTestContext();
    context.ui.showQuickPick = vi.fn();
    return context;
}

const credentials: CosmosDBCredential[] = [
    { type: AuthenticationMethod.accountKey, key: 'secret-account-key' },
    { type: AuthenticationMethod.managedIdentity, clientId: 'private-client-id' },
    { type: AuthenticationMethod.entraId, tenantId },
];

function database(id: string): Awaited<ReturnType<CosmosDBControlPlane['listDatabases']>>[number] {
    return { id, _rid: 'rid', _ts: 0, _self: '', _etag: 'etag' };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getCosmosDBCredentials).mockResolvedValue(credentials);
    mocks.listDatabases.mockResolvedValue([database(databaseId), database('second-db')]);
    vi.spyOn(vscode.env, 'openExternal').mockResolvedValue(true);
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);
});

afterEach(() => {
    expect(cosmosDBCreateDatabase).not.toHaveBeenCalled();
    expect(cosmosDBCreateContainer).not.toHaveBeenCalled();
    expect(cosmosDBDeleteDatabaseAccount).not.toHaveBeenCalled();
    expect(createCosmosDBManagementClient).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    vi.restoreAllMocks();
});

describe('runAccountAction without Explorer nodes', () => {
    it('creates a database directly from metadata-derived AccountInfo', async () => {
        const context = actionContext();
        const resource = metadata({ capabilities: [{ name: 'EnableServerless' }] });
        await expect(runAccountAction(context, resource, { action: 'createDatabase' })).resolves.toEqual({
            status: 'completed',
        });
        expect(getCosmosDBCredentials).toHaveBeenCalledExactlyOnceWith({
            accountName: 'acct',
            documentEndpoint: resource.documentEndpoint,
            isEmulator: false,
            tenantId,
            arm: resource,
        });
        expect(createDatabase).toHaveBeenCalledExactlyOnceWith(
            context,
            {
                azureMetadata: resource,
                credentials,
                endpoint: resource.documentEndpoint,
                id: accountId,
                isEmulator: false,
                isServerless: true,
                name: 'acct',
            },
            CoreExperience,
        );
        expect(getControlPlane).not.toHaveBeenCalled();
        expect(context.ui.showQuickPick).not.toHaveBeenCalled();
    });

    it('validates the selected database through the account control plane', async () => {
        const context = actionContext();
        const resource = metadata();
        await expect(runAccountAction(context, resource, { action: 'createContainer', databaseId })).resolves.toEqual({
            status: 'completed',
        });
        const info = vi.mocked(createContainer).mock.calls[0][1];
        expect(info.azureMetadata).toBe(resource);
        expect(info.credentials).toBe(credentials);
        expect(getControlPlane).toHaveBeenCalledExactlyOnceWith(info);
        expect(mocks.listDatabases).toHaveBeenCalledExactlyOnceWith();
        expect(createContainer).toHaveBeenCalledExactlyOnceWith(context, info, databaseId, CoreExperience);
        expect(context.ui.showQuickPick).not.toHaveBeenCalled();
    });

    it('picks a database from the current account using plain IDs, not tree models', async () => {
        mocks.listDatabases.mockResolvedValue([database('second-db'), database(databaseId)]);
        const context = actionContext();
        const selection: IAzureQuickPickItem<string> = { label: 'second-db', data: 'second-db' };
        vi.mocked(context.ui.showQuickPick).mockResolvedValue(selection);
        await expect(runAccountAction(context, metadata(), { action: 'createContainer' })).resolves.toEqual({
            status: 'completed',
        });
        expect(context.ui.showQuickPick).toHaveBeenCalledExactlyOnceWith(
            [
                { label: databaseId, data: databaseId },
                { label: 'second-db', data: 'second-db' },
            ],
            { placeHolder: 'Select a database for the new container' },
        );
        expect(createContainer).toHaveBeenCalledExactlyOnceWith(
            context,
            expect.objectContaining({ id: accountId }),
            'second-db',
            CoreExperience,
        );
    });

    it('masks database names before prompting and preserves picker cancellation', async () => {
        const context = actionContext();
        vi.mocked(context.ui.showQuickPick).mockImplementationOnce(async () => {
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([databaseId, "customer''s database", 'customer%27s%20database']),
            );
            throw new UserCancelledError();
        });
        await expect(runAccountAction(context, metadata(), { action: 'createContainer' })).resolves.toEqual({
            status: 'cancelled',
        });
        expect(createContainer).not.toHaveBeenCalled();
        expect(context.telemetry.properties.result).toBe('Canceled');
    });

    it('propagates database listing failures without opening an unscoped picker', async () => {
        const failure = new Error('Unable to list databases');
        mocks.listDatabases.mockRejectedValueOnce(failure);
        const context = actionContext();
        await expect(runAccountAction(context, metadata(), { action: 'createContainer' })).rejects.toBe(failure);
        expect(context.ui.showQuickPick).not.toHaveBeenCalled();
        expect(createContainer).not.toHaveBeenCalled();
    });

    it('reports an empty account instead of starting an unscoped wizard', async () => {
        mocks.listDatabases.mockResolvedValue([]);
        const context = actionContext();
        await expect(runAccountAction(context, metadata(), { action: 'createContainer' })).rejects.toThrow(
            'This account has no databases. Create a database before adding a container.',
        );
        expect(context.ui.showQuickPick).not.toHaveBeenCalled();
        expect(createContainer).not.toHaveBeenCalled();
    });

    it.each(['missing-db', databaseId.toUpperCase()])('rejects a stale or case-mismatched database %s', async (id) => {
        const context = actionContext();
        await expect(
            runAccountAction(context, metadata(), { action: 'createContainer', databaseId: id }),
        ).rejects.toThrow('Unable to resolve the selected database in this account.');
        expect(context.ui.showQuickPick).not.toHaveBeenCalled();
        expect(createContainer).not.toHaveBeenCalled();
    });

    it.each([undefined, 'other-account-db'])('rejects a picker result outside the account: %s', async (selection) => {
        const context = actionContext();
        const item: IAzureQuickPickItem<string | undefined> = { label: 'invalid', data: selection };
        vi.mocked(context.ui.showQuickPick).mockResolvedValue(item);
        await expect(runAccountAction(context, metadata(), { action: 'createContainer' })).rejects.toThrow(
            'Unable to resolve the selected database in this account.',
        );
        expect(createContainer).not.toHaveBeenCalled();
    });

    it.each(nonNoSqlAccounts)('rejects creation for non-NoSQL metadata: %j', async (account) => {
        for (const input of [
            { action: 'createDatabase' },
            { action: 'createContainer', databaseId },
            { action: 'createContainer' },
        ] satisfies AccountActionInput[]) {
            await expect(runAccountAction(actionContext(), metadata(account), input)).rejects.toThrow(
                'only supported for NoSQL',
            );
        }
        expect(getCosmosDBCredentials).not.toHaveBeenCalled();
        expect(createDatabase).not.toHaveBeenCalled();
        expect(createContainer).not.toHaveBeenCalled();
    });

    it.each([{}, ...nonNoSqlAccounts])('opens Data Modeler without an Explorer node for %j', async (account) => {
        const context = actionContext();
        const resource = metadata(account);
        await expect(runAccountAction(context, resource, { action: 'openDataModeler' })).resolves.toEqual({
            status: 'completed',
        });
        expect(getCosmosDBCredentials).toHaveBeenCalledExactlyOnceWith({
            accountName: 'acct',
            documentEndpoint: resource.documentEndpoint,
            isEmulator: false,
            tenantId,
            arm: resource,
        });
        expect(openDataModelingWizard).toHaveBeenCalledExactlyOnceWith(
            context,
            expect.objectContaining({
                azureMetadata: resource,
                credentials,
                id: accountId,
            }),
        );
        expect(mocks.listDatabases).not.toHaveBeenCalled();
    });

    it('deletes a non-NoSQL account from metadata without acquiring data-plane credentials', async () => {
        const context = actionContext();
        const resource = metadata({ kind: 'MongoDB' });
        await expect(runAccountAction(context, resource, { action: 'deleteAccount' })).resolves.toEqual({
            status: 'completed',
        });
        expect(deleteDatabaseAccount).toHaveBeenCalledExactlyOnceWith(context, resource);
        expect(getCosmosDBCredentials).not.toHaveBeenCalled();
    });

    it('waits for deletion before reporting completion', async () => {
        const deletion = Promise.withResolvers<void>();
        vi.mocked(deleteDatabaseAccount).mockReturnValueOnce(deletion.promise);
        const settled = vi.fn();
        const action = runAccountAction(actionContext(), metadata(), { action: 'deleteAccount' }).then(settled);
        expect(deleteDatabaseAccount).toHaveBeenCalledOnce();
        expect(settled).not.toHaveBeenCalled();
        deletion.resolve();
        await action;
        expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 'completed' });
    });

    it.each([
        [{ action: 'createDatabase' }, createDatabase],
        [{ action: 'createContainer', databaseId }, createContainer],
        [{ action: 'deleteAccount' }, deleteDatabaseAccount],
        [{ action: 'openJson' }, openAccountJson],
        [{ action: 'openDataModeler' }, openDataModelingWizard],
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

    it('registers error-path masks before acquiring credentials without explicitly masking the tenant', async () => {
        const context = actionContext();
        const failure = new Error('credentials failed');
        vi.mocked(getCosmosDBCredentials).mockImplementationOnce(async () => {
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

    it('masks connection credentials before accessing the control plane', async () => {
        const context = actionContext();
        mocks.listDatabases.mockImplementationOnce(async () => {
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([
                    'secret-account-key',
                    'private-client-id',
                    'https://acct.documents.azure.com:443/',
                    databaseId,
                ]),
            );
            expect(context.valuesToMask).not.toContain(tenantId);
            throw new Error('listing failed');
        });
        await expect(runAccountAction(context, metadata(), { action: 'createContainer', databaseId })).rejects.toThrow(
            'listing failed',
        );
        expect(context.telemetry.properties).toEqual({});
    });

    it('dispatches JSON directly from metadata', async () => {
        const context = actionContext();
        const resource = metadata();
        await expect(runAccountAction(context, resource, { action: 'openJson' })).resolves.toEqual({
            status: 'completed',
        });
        expect(openAccountJson).toHaveBeenCalledExactlyOnceWith(context, resource);
        expect(getCosmosDBCredentials).not.toHaveBeenCalled();
    });

    it('opens costs in the sovereign portal and rejects a refused browser launch', async () => {
        await expect(runAccountAction(actionContext(), metadata(), { action: 'openCosts' })).resolves.toEqual({
            status: 'completed',
        });
        const uri = vi.mocked(vscode.env.openExternal).mock.calls[0][0];
        expect(uri).toEqual(vscode.Uri.parse(buildAccountCostsUrl('https://portal.azure.us/', tenantId, accountId)));
        expect(getCosmosDBCredentials).not.toHaveBeenCalled();
        vi.mocked(vscode.env.openExternal).mockResolvedValueOnce(false);
        await expect(runAccountAction(actionContext(), metadata(), { action: 'openCosts' })).rejects.toThrow(
            'Unable to open account costs',
        );
    });
});

describe('account action boundaries', () => {
    it.each([
        'https://portal.azure.us/',
        'https://portal.azure.cn',
        'https://portal.azure.com/',
        'https://ms.portal.azure.com',
    ])('encodes the tenant and complete ARM scope for %s', (portal) => {
        expect(buildAccountCostsUrl(portal, 'tenant/# ?@', '/subscriptions/sub/rg/a b?#%')).toBe(
            `${portal.replace(/\/$/, '')}/#@tenant%2F%23%20%3F%40/view/Microsoft_Azure_CostManagement/CostAnalysis/scope/%2Fsubscriptions%2Fsub%2Frg%2Fa%20b%3F%23%25`,
        );
    });

    it.each(['', 'db/other', 'db\\other', 'db?other', 'db#other'])('rejects invalid database ID %j', (id) => {
        expect(accountActionInput.safeParse({ action: 'createContainer', databaseId: id }).success).toBe(false);
    });

    it('rejects an unknown action but allows account-scoped creation without a database target', () => {
        expect(accountActionInput.safeParse({ action: 'executeCommand' }).success).toBe(false);
        expect(accountActionInput.parse({ action: 'openDataModeler' })).toEqual({ action: 'openDataModeler' });
        expect(accountActionInput.parse({ action: 'createContainer' })).toEqual({ action: 'createContainer' });
        expect(accountActionInput.parse({ action: 'createContainer', databaseId })).toEqual({
            action: 'createContainer',
            databaseId,
        });
    });
});
