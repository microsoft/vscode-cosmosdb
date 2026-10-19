/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ArmTestMetadata, createArmTestClient, createArmTestContext } from '../../../../cosmosdb/armTestUtils';
import { AuthenticationMethod } from '../../../../cosmosdb/AuthenticationMethod';
import { getCosmosDBCredentials } from '../../../../cosmosdb/CosmosDBCredential';
import { ext } from '../../../../extensionVariables';
import { revealAzureResourceInExplorer } from '../../../../vscodeUriHandler';
import { QueryEditorTab } from '../../../QueryEditorTab';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { actionsProcedures } from './actionsRouter';

vi.mock('@vscode/extension-telemetry', () => ({ default: class {} }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    parseAzureResourceId: vi.fn(() => ({ subscriptionId: 'sub-1', resourceGroup: 'rg', resourceName: 'account' })),
}));
vi.mock('../../../../utils/azureClients', () => ({}));
vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    env: { openExternal: vi.fn() },
}));
vi.mock('../../trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const trpc = initWebviewTrpc<AccountOverviewRouterContext>();
    return { accountOverviewProcedure: trpc.publicProcedure, accountOverviewRouter: trpc.router };
});
vi.mock('../../../../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBCredentials: vi.fn() }));
vi.mock('../../../../extensionVariables', () => ({ ext: { outputChannel: { show: vi.fn() } } }));
vi.mock('../../../../vscodeUriHandler', () => ({ revealAzureResourceInExplorer: vi.fn() }));
vi.mock('../../../QueryEditorTab', () => ({ QueryEditorTab: { render: vi.fn() } }));
vi.mock('../../../accountOverview/services/accountActions', () => ({ runAccountAction: vi.fn() }));

const router = accountOverviewRouter(actionsProcedures);

class TestMetadata extends ArmTestMetadata {
    public override readonly accountId =
        '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account';
}

function createCaller() {
    const metadata = new TestMetadata(createArmTestClient());
    const actionContext = createArmTestContext();
    const caller = router.createCaller({
        webviewName: 'cosmosDbAccountOverview',
        metadata,
        actionContext,
        getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
        onNavigation: () => ({ dispose() {} }),
    });
    return { caller, actionContext };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(vscode.env.openExternal).mockResolvedValue(true);
    vi.mocked(getCosmosDBCredentials).mockResolvedValue([]);
});

describe('Account Overview auxiliary action routes', () => {
    it('displays one native notification and masks its message before dispatch', async () => {
        const { caller, actionContext } = createCaller();
        const message = 'Unable to open private-resource';
        vi.mocked(vscode.window.showErrorMessage).mockImplementationOnce(() => {
            expect(actionContext.valuesToMask).toContain(message);
            return Promise.resolve(undefined);
        });
        await caller.showErrorMessage({ message });
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(message);
    });

    it('opens the supplied URL and masks it before a browser failure can reach telemetry', async () => {
        const { caller, actionContext } = createCaller();
        const url = 'https://ms.portal.azure.com/#@tenant/resource/account';
        vi.mocked(vscode.env.openExternal).mockImplementationOnce(async () => {
            expect(actionContext.valuesToMask).toContain(url);
            return true;
        });
        await caller.openUrl({ url });
        expect(vscode.env.openExternal).toHaveBeenCalledExactlyOnceWith(vscode.Uri.parse(url));
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('rejects a refused browser launch instead of returning success', async () => {
        const { caller } = createCaller();
        vi.mocked(vscode.env.openExternal).mockResolvedValueOnce(false);
        await expect(caller.openUrl({ url: 'https://example.invalid' })).rejects.toThrow(
            'Unable to open the link in your browser.',
        );
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('propagates browser errors to the single RPC notification owner', async () => {
        const { caller } = createCaller();
        vi.mocked(vscode.env.openExternal).mockRejectedValueOnce(new Error('Browser failed'));
        await expect(caller.openUrl({ url: 'https://example.invalid' })).rejects.toThrow('Browser failed');
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('propagates Output and Reveal failures without displaying duplicate host notifications', async () => {
        const { caller } = createCaller();
        vi.mocked(ext.outputChannel.show).mockImplementationOnce(() => {
            throw new Error('Output failed');
        });
        await expect(caller.showOutput()).rejects.toThrow('Output failed');
        vi.mocked(revealAzureResourceInExplorer).mockRejectedValueOnce(new Error('Reveal failed'));
        await expect(caller.revealInTree({ databaseId: 'db', containerId: 'container' })).rejects.toThrow(
            'Reveal failed',
        );
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('masks query resource names before credentials and secrets before rendering the editor', async () => {
        const { caller, actionContext } = createCaller();
        vi.mocked(getCosmosDBCredentials).mockImplementationOnce(async () => {
            expect(actionContext.valuesToMask).toEqual(expect.arrayContaining(['db', 'container']));
            return [{ type: AuthenticationMethod.accountKey, key: 'private-key' }];
        });
        vi.mocked(QueryEditorTab.render).mockImplementationOnce(() => {
            expect(actionContext.valuesToMask).toContain('private-key');
            throw new Error('Editor failed');
        });
        await expect(caller.openQueryEditor({ databaseId: 'db', containerId: 'container' })).rejects.toThrow(
            'Editor failed',
        );
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
});
