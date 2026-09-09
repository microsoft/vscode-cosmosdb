/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { openDataModelingWizard } from '../commands/dataModeling/openDataModelingWizard';
import { openDataModelingWizardDrawer } from '../commands/dataModeling/openDataModelingWizardDrawer';
import { DataModelerProjectService } from '../services/DataModelerProjectService';
import { getAccountInfo } from '../tree/cosmosdb/AccountInfo';
import { type CosmosDBAccountResourceItem } from '../tree/cosmosdb/CosmosDBAccountResourceItem';
import { pickAppResource } from '../utils/pickItem/pickAppResource';
import { DataModelingWizardDrawerTab } from './DataModelingWizardDrawerTab';
import { DataModelingWizardTab } from './DataModelingWizardTab';
import { type DataModelingRouterContext } from './trpc/appRouter';

vi.mock('../extensionVariables', () => ({
    ext: {
        context: {
            get globalStorageUri() {
                return vscode.Uri.file('C:\\global-storage\\modeler-panels');
            },
        },
        outputChannel: { info: vi.fn(), warn: vi.fn() },
    },
}));
vi.mock('@microsoft/vscode-ext-webview/host', () => {
    const host = { attachTrpc: vi.fn(() => ({ disposable: { dispose: vi.fn() } })) };
    return { ...host, default: host };
});
vi.mock('./trpc/appRouter', () => ({ dataModelingAppRouter: {}, dataModelingCallerFactory: vi.fn() }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'Microsoft.DocumentDB/databaseAccounts' },
}));
vi.mock('../tree/cosmosdb/AccountInfo', () => ({ getAccountInfo: vi.fn() }));
vi.mock('../utils/pickItem/pickAppResource', () => ({ pickAppResource: vi.fn() }));
vi.mock('./BaseTab', () => ({
    BaseTab: class {
        protected readonly id = globalThis.crypto.randomUUID();
        protected disposables: vscode.Disposable[] = [];
        constructor(protected readonly panel: vscode.WebviewPanel) {}
        dispose() {
            this.panel.dispose();
        }
    },
}));

const firstAccount = { endpoint: 'https://account-a.documents.azure.com/', name: 'Same display name' };
const secondAccount = { endpoint: 'https://account-b.documents.azure.com/', name: 'Same display name' };

function panel(): vscode.WebviewPanel {
    return {
        viewType: 'test',
        title: '',
        options: {},
        active: true,
        visible: true,
        viewColumn: vscode.ViewColumn.Active,
        onDidDispose: vi.fn(),
        onDidChangeViewState: vi.fn(),
        reveal: vi.fn(),
        dispose: vi.fn(),
        webview: {
            html: '',
            options: {},
            cspSource: '',
            onDidReceiveMessage: vi.fn(),
            postMessage: vi.fn(),
            asWebviewUri: (uri) => uri,
        },
    };
}

function lastContext(): DataModelingRouterContext {
    return vi.mocked(attachTrpc).mock.calls.at(-1)?.[1] as DataModelingRouterContext;
}

function actionContext(): IActionContext {
    return {
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: {
            onDidFinishPrompt: vi.fn(),
            showQuickPick: vi.fn(),
            showInputBox: vi.fn(),
            showWarningMessage: vi.fn(),
            showOpenDialog: vi.fn(),
            showWorkspaceFolderPick: vi.fn(),
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(vscode.window, 'createWebviewPanel').mockImplementation(() => panel());
});
afterEach(() => {
    for (const tab of DataModelingWizardTab.openTabs) tab.dispose();
    for (const tab of DataModelingWizardDrawerTab.openTabs) tab.dispose();
    vi.restoreAllMocks();
});

describe.each([
    {
        name: 'full-page',
        render: DataModelingWizardTab.render.bind(DataModelingWizardTab),
        open: openDataModelingWizard,
    },
    {
        name: 'drawer',
        render: DataModelingWizardDrawerTab.render.bind(DataModelingWizardDrawerTab),
        open: openDataModelingWizardDrawer,
    },
])('$name data modeler account scope', ({ render, open }) => {
    it('reuses only the same account tab and binds each account to its own persistence service', () => {
        const first = render(firstAccount);
        const firstProject = lastContext().project;
        const second = render(secondAccount);
        const secondProject = lastContext().project;
        expect(second).not.toBe(first);
        expect(firstProject).toBe(DataModelerProjectService.getInstance(firstAccount.endpoint));
        expect(secondProject).toBe(DataModelerProjectService.getInstance(secondAccount.endpoint));
        expect(firstProject.projectUri.toString()).not.toBe(secondProject.projectUri.toString());
        expect(render({ endpoint: 'HTTPS://ACCOUNT-A.documents.azure.com:443', name: 'Renamed label' })).toBe(first);
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
        expect(attachTrpc).toHaveBeenCalledTimes(2);
    });

    it('uses the Account Overview descriptor directly without prompting or fetching credentials', async () => {
        const context = actionContext();
        await open(context, firstAccount);
        expect(pickAppResource).not.toHaveBeenCalled();
        expect(getAccountInfo).not.toHaveBeenCalled();
        expect(lastContext().project).toBe(DataModelerProjectService.getInstance(firstAccount.endpoint));
        expect(context.valuesToMask).toContain(firstAccount.endpoint);
        expect(context.valuesToMask).toContain(firstAccount.name);
    });

    it('accepts just an endpoint when account metadata and name are undefined', async () => {
        const context = actionContext();
        await open(context, { endpoint: firstAccount.endpoint });
        expect(pickAppResource).not.toHaveBeenCalled();
        expect(getAccountInfo).not.toHaveBeenCalled();
        expect(lastContext().project).toBe(DataModelerProjectService.getInstance(firstAccount.endpoint));
        expect(context.valuesToMask).toEqual([firstAccount.endpoint]);
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
            expect.any(String),
            'Data Modeler',
            expect.any(Number),
            expect.any(Object),
        );
    });

    it('prompts for an account when launched without context, and uses that account endpoint', async () => {
        const node = { account: { id: 'account-id', name: 'Account' } } as CosmosDBAccountResourceItem;
        vi.mocked(pickAppResource).mockResolvedValueOnce(node);
        vi.mocked(getAccountInfo).mockResolvedValueOnce({
            ...secondAccount,
            id: 'account-id',
            credentials: [],
            isEmulator: false,
            isServerless: false,
        });
        const context = actionContext();
        await open(context);
        expect(pickAppResource).toHaveBeenCalledOnce();
        expect(getAccountInfo).toHaveBeenCalledWith(node.account);
        expect(lastContext().project).toBe(DataModelerProjectService.getInstance(secondAccount.endpoint));
    });

    it('does not open an unscoped session when the account picker is cancelled', async () => {
        vi.mocked(pickAppResource).mockRejectedValueOnce(new vscode.CancellationError());
        await expect(open(actionContext())).rejects.toThrow(vscode.CancellationError);
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });
});

it('shares one account service across full-page and drawer presentations', () => {
    DataModelingWizardTab.render(firstAccount);
    const project = lastContext().project;
    DataModelingWizardDrawerTab.render(firstAccount);
    expect(lastContext().project).toBe(project);
});
