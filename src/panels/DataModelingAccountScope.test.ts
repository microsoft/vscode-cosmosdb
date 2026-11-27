/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { isDataModelerFeatureEnabled } from '../commands/dataModeling/dataModelerFeatureFlag';
import { openDataModelingWizard } from '../commands/dataModeling/openDataModelingWizard';
import { type AzureResourceMetadata } from '../cosmosdb/AzureResourceMetadata';
import { getControlPlane } from '../cosmosdb/controlPlane';
import { ModelingTelemetry } from '../dataModeling/ModelingTelemetry';
import { DataModelerProjectService } from '../services/DataModelerProjectService';
import { getAccountInfo, type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { type CosmosDBAccountResourceItem } from '../tree/cosmosdb/CosmosDBAccountResourceItem';
import { ensureAIFeaturesEnabled } from '../utils/copilotUtils';
import { pickAppResource } from '../utils/pickItem/pickAppResource';
import { createInitialSnapshot } from '../webviews/cosmosdb/DataModeling/dataModel';
import { DataModelingWizardTab } from './DataModelingWizardTab';
import { type DataModelingRouterContext } from './trpc/appRouter';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn().mockResolvedValue(undefined),
    UserCancelledError: class extends Error {},
}));

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
vi.mock('./trpc/appRouter', () => ({
    dataModelingAppRouter: {},
    dataModelingCallerFactory: vi.fn(),
}));
vi.mock('../utils/copilotUtils', () => ({ ensureAIFeaturesEnabled: vi.fn() }));
vi.mock('../commands/dataModeling/dataModelerFeatureFlag', () => ({ isDataModelerFeatureEnabled: vi.fn() }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'Microsoft.DocumentDB/databaseAccounts' },
}));
vi.mock('../tree/cosmosdb/AccountInfo', () => ({ getAccountInfo: vi.fn() }));
vi.mock('../cosmosdb/controlPlane', () => ({ getControlPlane: vi.fn() }));
vi.mock('../utils/pickItem/pickAppResource', () => ({ pickAppResource: vi.fn() }));
vi.mock('./BaseTab', () => ({
    BaseTab: class {
        public isDisposed = false;
        protected readonly id = globalThis.crypto.randomUUID();
        protected disposables: vscode.Disposable[] = [];
        constructor(protected readonly panel: vscode.WebviewPanel) {}
        dispose() {
            this.isDisposed = true;
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
    vi.mocked(isDataModelerFeatureEnabled).mockReset().mockReturnValue(true);
    vi.mocked(ensureAIFeaturesEnabled).mockReset().mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'createWebviewPanel').mockImplementation(() => panel());
    vi.spyOn(DataModelerProjectService.prototype, 'loadState').mockResolvedValue(null);
    vi.spyOn(DataModelerProjectService.prototype, 'saveState').mockResolvedValue(undefined);
    vi.spyOn(DataModelerProjectService.prototype, 'setDatabaseId').mockResolvedValue(undefined);
    vi.mocked(vscode.window.showWarningMessage).mockReset();
});
afterEach(() => {
    for (const tab of DataModelingWizardTab.openTabs) tab.dispose();
    vi.restoreAllMocks();
});

describe('data modeler account scope', () => {
    const render = DataModelingWizardTab.render.bind(DataModelingWizardTab);
    const open = openDataModelingWizard;

    it('persists the selected database and continues an already-open model for the same database', async () => {
        vi.mocked(DataModelerProjectService.prototype.loadState).mockResolvedValue(createInitialSnapshot());
        const context = actionContext();
        await open(context, firstAccount, 'first-db');
        const ctx = lastContext();
        expect(ctx.getDeploymentDatabaseId?.()).toBe('first-db');
        expect(context.valuesToMask).toContain('first-db');
        const tab = [...DataModelingWizardTab.openTabs][0];
        const emit = vi.spyOn(tab.eventSink, 'emit');

        await open(context, firstAccount, 'first-db');

        expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
        expect(ctx.getDeploymentDatabaseId?.()).toBe('first-db');
        expect(emit).not.toHaveBeenCalled();
        await open(context, secondAccount);
        expect(lastContext().getDeploymentDatabaseId?.()).toBeUndefined();
        expect(DataModelerProjectService.prototype.saveState).toHaveBeenCalledExactlyOnceWith({
            ...createInitialSnapshot(),
            databaseId: 'first-db',
        });
        expect(DataModelerProjectService.prototype.setDatabaseId).not.toHaveBeenCalled();
    });

    it.each(['Yes', 'No'])('keeps the existing choice for a saved model in the same database: %s', async (answer) => {
        const saved = { ...createInitialSnapshot(), databaseId: 'db' };
        saved.wizard.scenario = 'other';
        vi.mocked(DataModelerProjectService.prototype.loadState).mockResolvedValue(saved);
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === answer),
        );
        await open(actionContext(), firstAccount, 'db');
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Start a new data model?',
            expect.anything(),
            { title: 'Yes' },
            { title: 'No', isCloseAffordance: true },
        );
        expect(DataModelerProjectService.prototype.saveState).toHaveBeenCalledWith(
            answer === 'Yes' ? { ...createInitialSnapshot(), databaseId: 'db' } : saved,
        );
    });

    it('replaces a different saved database only on OK', async () => {
        vi.mocked(DataModelerProjectService.prototype.loadState).mockResolvedValue({
            ...createInitialSnapshot(),
            databaseId: 'old-db',
        });
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(
            async (_message, _options, ...items) => items[0],
        );
        await open(actionContext(), firstAccount, 'new-db');
        expect(DataModelerProjectService.prototype.saveState).toHaveBeenCalledExactlyOnceWith({
            ...createInitialSnapshot(),
            databaseId: 'new-db',
        });
        expect(lastContext().getDeploymentDatabaseId?.()).toBe('new-db');
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Replace the current data model?',
            expect.anything(),
            { title: 'OK' },
            { title: 'Cancel', isCloseAffordance: true },
        );
    });

    it.each(['Cancel', undefined])('preserves a different saved database on cancellation: %s', async (answer) => {
        const saved = { ...createInitialSnapshot(), databaseId: 'old-db' };
        vi.mocked(DataModelerProjectService.prototype.loadState).mockResolvedValue(saved);
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === answer),
        );
        await expect(open(actionContext(), firstAccount, 'new-db')).rejects.toBeInstanceOf(UserCancelledError);
        expect(DataModelerProjectService.prototype.saveState).not.toHaveBeenCalled();
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).toHaveBeenCalledExactlyOnceWith(
            'Replace the current data model?',
            {
                modal: true,
                detail: 'The current data model is for database "old-db". Replace it with a new model for "new-db"? Only the saved model will be replaced; Azure databases and containers will not be deleted.',
            },
            { title: 'OK' },
            { title: 'Cancel', isCloseAffordance: true },
        );
    });

    it('leaves an open model untouched on Cancel and retires it only after replacement is saved', async () => {
        const original = await render(firstAccount, undefined, 'old-db');
        const oldContext = lastContext();
        const emit = vi.spyOn(original.eventSink, 'emit');
        vi.mocked(DataModelerProjectService.prototype.saveState).mockClear();
        await expect(render(firstAccount, undefined, 'new-db')).rejects.toBeInstanceOf(UserCancelledError);
        expect(original.isDisposed).toBe(false);
        expect(oldContext.getDeploymentDatabaseId?.()).toBe('old-db');
        expect(oldContext.isModelActive?.()).toBe(true);
        expect(emit).not.toHaveBeenCalled();
        expect(DataModelerProjectService.prototype.saveState).not.toHaveBeenCalled();

        vi.mocked(vscode.window.showWarningMessage).mockImplementation(
            async (_message, _options, ...items) => items[0],
        );
        let finishSave!: () => void;
        vi.mocked(DataModelerProjectService.prototype.saveState).mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        );
        const replacing = render(firstAccount, undefined, 'new-db');
        await vi.waitFor(() => expect(oldContext.isModelActive?.()).toBe(false));
        expect(original.isDisposed).toBe(false);
        finishSave();
        const replacement = await replacing;
        expect(replacement).not.toBe(original);
        expect(original.isDisposed).toBe(true);
        expect(oldContext.isModelActive?.()).toBe(false);
        expect(lastContext().getDeploymentDatabaseId?.()).toBe('new-db');
    });

    it('preserves the open model and allows retry if replacement cannot be saved', async () => {
        const original = await render(firstAccount, undefined, 'old-db');
        const oldContext = lastContext();
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(
            async (_message, _options, ...items) => items[0],
        );
        vi.mocked(DataModelerProjectService.prototype.saveState).mockRejectedValueOnce(new Error('Write failed'));
        await expect(render(firstAccount, undefined, 'new-db')).rejects.toThrow('Write failed');
        expect(oldContext.isModelActive?.()).toBe(true);
        expect(oldContext.getDeploymentDatabaseId?.()).toBe('old-db');
        expect(original.isDisposed).toBe(false);
        expect(await render(firstAccount, undefined, 'new-db')).not.toBe(original);
    });

    it('restores a persisted association on account-only opens without inferring one for older models', async () => {
        vi.mocked(DataModelerProjectService.prototype.loadState)
            .mockResolvedValueOnce({
                ...createInitialSnapshot(),
                databaseId: 'db',
            })
            .mockResolvedValueOnce(createInitialSnapshot());
        await render(firstAccount);
        expect(lastContext().getDeploymentDatabaseId?.()).toBe('db');
        await render(secondAccount, undefined, 'selected-db');
        expect(vscode.window.showWarningMessage).toHaveBeenLastCalledWith(
            'Start a new data model?',
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );
        expect(lastContext().getDeploymentDatabaseId?.()).toBe('selected-db');
    });

    it('uses the database from a legacy successful deployment to detect a mismatch', async () => {
        const saved = createInitialSnapshot();
        saved.recommendation = {
            status: 'received',
            value: { summary: '', containers: [{ entity: 'Orders', partitionKey: '/id', rationale: '' }] },
        };
        saved.deployment = {
            input: {
                databaseMode: 'existing',
                databaseName: 'legacy-db',
                containers: [{ entity: 'Orders', partitionKey: '/id' }],
            },
            result: { status: 'deployed', databaseName: 'legacy-db', createdCount: 1, existingCount: 0 },
        };
        vi.mocked(DataModelerProjectService.prototype.loadState).mockResolvedValue(saved);
        await expect(render(firstAccount, undefined, 'new-db')).rejects.toBeInstanceOf(UserCancelledError);
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Replace the current data model?',
            expect.objectContaining({ detail: expect.stringContaining('"legacy-db"') }),
            expect.anything(),
            expect.anything(),
        );
        expect(DataModelerProjectService.prototype.saveState).not.toHaveBeenCalled();
    });

    it('blocks database-specific opens if the existing model cannot be read', async () => {
        vi.mocked(DataModelerProjectService.prototype.loadState).mockRejectedValue(new Error('Read failed'));
        await expect(open(actionContext(), firstAccount, 'db')).rejects.toThrow('Read failed');
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        expect(DataModelerProjectService.prototype.saveState).not.toHaveBeenCalled();
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    function mockSavedFile(read: () => Promise<Uint8Array>) {
        vi.mocked(DataModelerProjectService.prototype.loadState).mockRestore();
        vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({
            type: vscode.FileType.File,
            ctime: 0,
            mtime: Date.now(),
            size: 1,
        });
        vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(read);
        vi.spyOn(vscode.workspace.fs, 'delete').mockImplementation(async () => {
            vi.mocked(vscode.workspace.fs.stat).mockRejectedValue(vscode.FileSystemError.FileNotFound());
        });
    }

    it.each([
        ['json', '{broken'],
        ['schema', '{"version":1,"name":"Invalid","state":{}}'],
    ])('opens a fresh wizard after a saved-model %s failure instead of blocking panel creation', async (kind, text) => {
        mockSavedFile(async () => Buffer.from(text));
        await render({ endpoint: `https://recovery-${kind}.documents.azure.com` });
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
        expect(vscode.window.showWarningMessage).toHaveBeenCalledExactlyOnceWith(
            'Could not load the saved data model. Starting a new model on the Workload page.',
        );
        expect(vscode.workspace.fs.delete).toHaveBeenCalledOnce();
        expect(await lastContext().project.loadState()).toBeNull();
        expect(DataModelerProjectService.prototype.saveState).not.toHaveBeenCalled();
    });

    it.each([
        ['filesystem', () => Promise.reject(vscode.FileSystemError.NoPermissions())],
        ['newer version', () => Promise.resolve(Buffer.from('{"version":99}'))],
    ])(
        'opens the wizard after a saved-model %s failure and lets the webview see the load failure',
        async (kind, read) => {
            mockSavedFile(read);
            await render({ endpoint: `https://preserve-${kind.replace(' ', '-')}.documents.azure.com` });
            expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(vscode.workspace.fs.delete).not.toHaveBeenCalled();
            await expect(lastContext().project.loadState()).rejects.toThrow();
            expect(DataModelerProjectService.prototype.saveState).not.toHaveBeenCalled();
        },
    );

    it.each([undefined, firstAccount])('rejects opens when the Data Modeler flag is disabled', async (source) => {
        vi.mocked(isDataModelerFeatureEnabled).mockReturnValue(false);
        await expect(open(actionContext(), source)).rejects.toThrow('The Data Modeler wizard is disabled in settings.');
        expect(ensureAIFeaturesEnabled).not.toHaveBeenCalled();
        expect(pickAppResource).not.toHaveBeenCalled();
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('rechecks the feature flag after account resolution', async () => {
        vi.mocked(isDataModelerFeatureEnabled).mockReturnValueOnce(true).mockReturnValueOnce(false);
        await expect(open(actionContext(), firstAccount)).rejects.toThrow(
            'The Data Modeler wizard is disabled in settings.',
        );
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it.each([undefined, firstAccount])(
        'rejects direct opens before resolving an account when AI is unavailable',
        async (source) => {
            vi.mocked(ensureAIFeaturesEnabled).mockRejectedValueOnce(new Error('AI unavailable'));
            await expect(open(actionContext(), source)).rejects.toThrow('AI unavailable');
            expect(pickAppResource).not.toHaveBeenCalled();
            expect(getAccountInfo).not.toHaveBeenCalled();
            expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
        },
    );

    it('rechecks availability before rendering after account resolution', async () => {
        vi.mocked(ensureAIFeaturesEnabled)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('AI unavailable'));
        await expect(open(actionContext(), firstAccount)).rejects.toThrow('AI unavailable');
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('reuses only the same account tab and binds each account to its own persistence service', async () => {
        const first = await render(firstAccount);
        const firstProject = lastContext().project;
        expect(lastContext().account.endpoint).toBe(firstAccount.endpoint);
        const second = await render(secondAccount);
        const secondProject = lastContext().project;
        expect(lastContext().account.endpoint).toBe(secondAccount.endpoint);
        expect(second).not.toBe(first);
        expect(firstProject).toBe(DataModelerProjectService.getInstance(firstAccount.endpoint));
        expect(secondProject).toBe(DataModelerProjectService.getInstance(secondAccount.endpoint));
        expect(firstProject.projectUri.toString()).not.toBe(secondProject.projectUri.toString());
        expect(await render({ endpoint: 'HTTPS://ACCOUNT-A.documents.azure.com:443', name: 'Renamed label' })).toBe(
            first,
        );
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
        expect(attachTrpc).toHaveBeenCalledTimes(2);
    });

    it('uses an account descriptor directly without prompting or fetching credentials', async () => {
        const context = actionContext();
        await open(context, firstAccount);
        expect(pickAppResource).not.toHaveBeenCalled();
        expect(getAccountInfo).not.toHaveBeenCalled();
        expect(lastContext().project).toBe(DataModelerProjectService.getInstance(firstAccount.endpoint));
        expect(context.valuesToMask).toContain(firstAccount.endpoint);
        expect(context.valuesToMask).toContain(firstAccount.name);
    });

    it('preserves deployment and query capabilities when Overview passes AccountInfo without a tree node', async () => {
        const metadata = { accountName: firstAccount.name } as AzureResourceMetadata;
        const info: AccountInfo = {
            ...firstAccount,
            id: 'account-id',
            credentials: [],
            isEmulator: false,
            isServerless: false,
            azureMetadata: metadata,
        };
        await open(actionContext(), info);
        expect(pickAppResource).not.toHaveBeenCalled();
        expect(getAccountInfo).not.toHaveBeenCalled();
        const account = lastContext().account;
        expect(account.getControlPlane).toBeTypeOf('function');
        account.getControlPlane?.();
        expect(getControlPlane).toHaveBeenCalledExactlyOnceWith(info);
        expect(account.getDeploymentTarget?.()).toBe(metadata);
        expect(await account.getQueryConnection?.('database', 'container')).toEqual({
            azureMetadata: metadata,
            databaseId: 'database',
            containerId: 'container',
            endpoint: info.endpoint,
            credentials: info.credentials,
            isEmulator: false,
        });
        expect(account).not.toHaveProperty('credentials');
    });

    it('preserves the host-only deployment capability and updates it when reopening an endpoint-only tab', async () => {
        const tab = await render(firstAccount);
        const context = lastContext();
        const capability = vi.fn();
        const deploymentTarget = vi.fn();
        const queryConnection = vi.fn();
        expect(context.account.getControlPlane).toBeUndefined();
        expect(
            await render({
                ...firstAccount,
                getControlPlane: capability,
                getDeploymentTarget: deploymentTarget,
                getQueryConnection: queryConnection,
            }),
        ).toBe(tab);
        expect(context.account.getControlPlane).toBe(capability);
        expect(context.account.getDeploymentTarget).toBe(deploymentTarget);
        expect(context.account.getQueryConnection).toBe(queryConnection);
        context.account.getControlPlane?.();
        expect(capability).toHaveBeenCalledOnce();
        expect(await render(firstAccount)).toBe(tab);
        expect(context.account.getControlPlane).toBe(capability);
        expect(context.account.getDeploymentTarget).toBe(deploymentTarget);
        expect(context.account.getQueryConnection).toBe(queryConnection);
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

    it.each(['Yes', 'No', 'Escape', undefined])(
        'settles the saved-model choice before creating the tab (choice: %s)',
        async (choice) => {
            const saved = createInitialSnapshot();
            saved.wizard.scenario = 'other';
            vi.mocked(DataModelerProjectService.prototype.loadState).mockResolvedValue(saved);
            const record = vi.spyOn(ModelingTelemetry.prototype, 'record');
            let answer!: () => void;
            vi.mocked(vscode.window.showWarningMessage).mockImplementation(
                async (_message, _options, ...items) =>
                    new Promise<vscode.MessageItem | undefined>((resolve) => {
                        answer = () =>
                            resolve(
                                items.find((item) =>
                                    choice === 'Escape' ? item.isCloseAffordance : item.title === choice,
                                ),
                            );
                    }),
            );
            const opening = render(firstAccount);
            await vi.waitFor(() => expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce());
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                'Start a new data model?',
                {
                    modal: true,
                    detail: 'A saved data model was found. Choose Yes to start a new model and replace the saved one, or No to continue where you left off.',
                },
                { title: 'Yes' },
                { title: 'No', isCloseAffordance: true },
            );
            expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
            expect(attachTrpc).not.toHaveBeenCalled();
            expect(DataModelerProjectService.prototype.saveState).not.toHaveBeenCalled();
            answer();
            const tab = await opening;
            expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
            expect(record).toHaveBeenCalledWith({
                type: 'sessionChoice',
                choice: choice === 'Yes' ? 'replaced' : 'continued',
            });
            expect(vi.mocked(DataModelerProjectService.prototype.saveState).mock.calls).toEqual(
                choice === 'Yes' ? [[createInitialSnapshot()]] : [],
            );
            expect(await render(firstAccount)).toBe(tab);
            expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
            expect(DataModelerProjectService.prototype.loadState).toHaveBeenCalledOnce();
        },
    );

    it('opens a fresh session without prompting or saving', async () => {
        const record = vi.spyOn(ModelingTelemetry.prototype, 'record');
        await render(firstAccount);
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        expect(DataModelerProjectService.prototype.saveState).not.toHaveBeenCalled();
        expect(record).toHaveBeenCalledWith({ type: 'sessionChoice', choice: 'new' });
    });

    it('waits for the explicitly requested replacement to save before creating the webview', async () => {
        vi.mocked(DataModelerProjectService.prototype.loadState).mockResolvedValue(createInitialSnapshot());
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(
            async (_message, _options, ...items) => items[0],
        );
        let finishSave!: () => void;
        vi.mocked(DataModelerProjectService.prototype.saveState).mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        );
        const opening = render(firstAccount);
        await vi.waitFor(() => expect(DataModelerProjectService.prototype.saveState).toHaveBeenCalledOnce());
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
        finishSave();
        await opening;
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    });

    it('shares an in-flight open without duplicating the prompt or tab', async () => {
        let finishLoad!: (value: ReturnType<typeof createInitialSnapshot>) => void;
        vi.mocked(DataModelerProjectService.prototype.loadState).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishLoad = resolve;
                }),
        );
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(
            async (_message, _options, ...items) => items[1],
        );
        const first = render(firstAccount);
        const capability = vi.fn();
        const second = render({ ...firstAccount, getControlPlane: capability });
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
        finishLoad(createInitialSnapshot());
        expect(await second).toBe(await first);
        expect(lastContext().account.getControlPlane).toBe(capability);
        expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    });

    it.each(['prompt', 'save'])('surfaces %s failures without opening a tab and allows retry', async (stage) => {
        const error = new Error('Storage or prompt unavailable');
        vi.mocked(DataModelerProjectService.prototype.loadState).mockResolvedValue(createInitialSnapshot());
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(
            async (_message, _options, ...items) => items[0],
        );
        if (stage === 'prompt') vi.mocked(vscode.window.showWarningMessage).mockRejectedValueOnce(error);
        if (stage === 'save') vi.mocked(DataModelerProjectService.prototype.saveState).mockRejectedValueOnce(error);
        const context = actionContext();
        await expect(open(context, firstAccount)).rejects.toThrow(error);
        expect(context.telemetry.suppressAll).toBe(true);
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
        expect(DataModelerProjectService.prototype.saveState).toHaveBeenCalledTimes(stage === 'save' ? 1 : 0);
        await open(actionContext(), firstAccount);
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    });

    it('prompts for an account when launched without context, and uses that account endpoint', async () => {
        const node = { account: { id: 'account-id', name: 'Account' } } as CosmosDBAccountResourceItem;
        const metadata = { accountName: secondAccount.name } as AzureResourceMetadata;
        vi.mocked(pickAppResource).mockResolvedValueOnce(node);
        vi.mocked(getAccountInfo).mockResolvedValueOnce({
            ...secondAccount,
            id: 'account-id',
            credentials: [],
            isEmulator: false,
            isServerless: false,
            azureMetadata: metadata,
        });
        const context = actionContext();
        await open(context);
        expect(pickAppResource).toHaveBeenCalledOnce();
        expect(getAccountInfo).toHaveBeenCalledWith(node.account);
        expect(lastContext().project).toBe(DataModelerProjectService.getInstance(secondAccount.endpoint));
        expect(lastContext().account.getControlPlane).toBeTypeOf('function');
        expect(lastContext().account.getDeploymentTarget?.()).toBe(metadata);
        expect(await lastContext().account.getQueryConnection?.('deployed-db', 'Orders')).toEqual({
            endpoint: secondAccount.endpoint,
            databaseId: 'deployed-db',
            containerId: 'Orders',
            credentials: [],
            isEmulator: false,
            azureMetadata: metadata,
        });
        lastContext().account.getControlPlane?.();
        expect(getControlPlane).toHaveBeenCalledWith(expect.objectContaining({ endpoint: secondAccount.endpoint }));
    });

    it('does not open an unscoped session when the account picker is cancelled', async () => {
        vi.mocked(pickAppResource).mockRejectedValueOnce(new vscode.CancellationError());
        await expect(open(actionContext())).rejects.toThrow(vscode.CancellationError);
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it.each([false, true])('preserves attached-account credentials and emulator mode (%s)', async (isEmulator) => {
        const node = { account: { id: 'attached-id' } } as CosmosDBAccountResourceItem;
        const accountInfo = {
            ...firstAccount,
            id: 'attached-id',
            credentials: [],
            isEmulator,
            isServerless: false,
        };
        vi.mocked(getAccountInfo).mockResolvedValueOnce(accountInfo);
        await open(actionContext(), node);
        const connection = await lastContext().account.getQueryConnection?.('db', 'Users');
        expect(connection).toEqual({
            endpoint: firstAccount.endpoint,
            databaseId: 'db',
            containerId: 'Users',
            credentials: accountInfo.credentials,
            isEmulator,
            azureMetadata: undefined,
        });
        expect(connection?.credentials).toBe(accountInfo.credentials);
    });
});
