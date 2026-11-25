/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { diagnoseConnection } from './diagnoseConnection';

const mocks = vi.hoisted(() => ({ render: vi.fn(), pickAppResource: vi.fn(), getChildren: vi.fn() }));
vi.mock('vscode', () => ({ window: { showQuickPick: vi.fn(), showInformationMessage: vi.fn() } }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'AzureCosmosDb' },
}));
vi.mock('../panels/ConnectionDiagnosticsTab', () => ({ ConnectionDiagnosticsTab: { render: mocks.render } }));
vi.mock('../utils/pickItem/pickAppResource', () => ({ pickAppResource: mocks.pickAppResource }));
vi.mock('../extensionVariables', () => ({
    ext: { cosmosDBWorkspaceBranchDataResource: { getChildren: mocks.getChildren } },
}));
vi.mock('../tree/workspace-view/cosmosdb/LocalEmulators/LocalCoreEmulatorsItem', () => ({
    LocalCoreEmulatorsItem: { groupContextValue: 'treeItem.localEmulators' },
}));

const azureAccount = {
    id: '/subscriptions/example/resourceGroups/test/providers/Microsoft.DocumentDB/databaseAccounts/example',
    name: 'Example',
    type: 'Microsoft.DocumentDB/databaseAccounts',
    subscription: { subscriptionId: 'example' },
};
const attachedAccount = {
    id: 'saved',
    name: 'Saved',
    storageId: 'saved',
    isEmulator: false,
    connectionString: 'AccountEndpoint=https://example.test/;AccountKey=test-key;',
};
const azureNode = { contextValue: 'treeItem.unsupportedAccount;cosmosDBConnectionTarget', account: azureAccount };
const attachedNode = {
    contextValue: 'cosmosDBConnectionTarget;treeItem.account;experience.Cassandra',
    account: attachedAccount,
};

function actionContext(): IActionContext {
    return {
        errorHandling: { issueProperties: {} },
        telemetry: { properties: {}, measurements: {} },
        ui: {} as IActionContext['ui'],
        valuesToMask: [],
    };
}

describe('Diagnose Connection target selection', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('accepts a plain NoSQL tree element by its context, without a class instance', async () => {
        await diagnoseConnection(actionContext(), {
            contextValue: 'experience.Core;cosmosDBConnectionTarget;treeItem.account',
            account: azureAccount,
        });
        expect(mocks.render).toHaveBeenCalledWith({ kind: 'azure', probe: 'nosql', account: azureAccount });
    });

    it('allows Cosmos DB accounts that do not support the NoSQL SDK probe', async () => {
        await diagnoseConnection(actionContext(), azureNode);
        expect(mocks.render).toHaveBeenCalledWith({ kind: 'azure', probe: 'network', account: azureAccount });
    });

    it('rejects PostgreSQL even if its context happens to include the diagnostics marker', async () => {
        await diagnoseConnection(actionContext(), {
            ...azureNode,
            account: { ...azureAccount, type: 'Microsoft.DBforPostgreSQL/flexibleServers' },
        });
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it('uses the Cosmos DB resource type in the Azure picker without filtering by API', async () => {
        vi.mocked(vscode.window.showQuickPick).mockImplementationOnce((items) =>
            Promise.resolve(Array.isArray(items) ? items[0] : undefined),
        );
        mocks.pickAppResource.mockResolvedValueOnce(azureNode);
        const context = actionContext();
        await diagnoseConnection(context);
        expect(mocks.pickAppResource).toHaveBeenCalledWith(context, { type: AzExtResourceType.AzureCosmosDb });
        expect(mocks.render).toHaveBeenCalledWith({ kind: 'azure', probe: 'network', account: azureAccount });
    });

    it('lists a saved non-NoSQL connection and a local emulator by context value', async () => {
        const emulator = { ...attachedAccount, name: 'Emulator', isEmulator: true };
        mocks.getChildren.mockResolvedValueOnce([
            attachedNode,
            {
                contextValue: 'treeItem.newConnection;treeItem.localEmulators',
                getChildren: () => [
                    { contextValue: 'experience.Core;cosmosDBConnectionTarget;treeItem.account', account: emulator },
                ],
            },
            { contextValue: 'treeItem.accounts' },
        ]);
        const picker = vi.mocked(vscode.window.showQuickPick);
        picker.mockImplementationOnce((items) => Promise.resolve(Array.isArray(items) ? items[1] : undefined));
        picker.mockImplementationOnce((items) => Promise.resolve(Array.isArray(items) ? items[0] : undefined));
        const context = actionContext();
        await diagnoseConnection(context);
        expect(picker).toHaveBeenLastCalledWith(
            [expect.objectContaining({ label: 'Saved' }), expect.objectContaining({ label: 'Emulator' })],
            expect.anything(),
        );
        expect(mocks.render).toHaveBeenCalledWith({ kind: 'attached', probe: 'network', account: attachedAccount });
        expect(context.valuesToMask).toContain(attachedAccount.connectionString);
    });
});
