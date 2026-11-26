/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type DiagnosticsState } from '../connectionDiagnostics/model';
import { runDiagnostics } from '../connectionDiagnostics/run';
import { armTestSubscription, createArmTestContext } from '../cosmosdb/armTestUtils';
import { type CosmosDBAccountModel } from '../tree/cosmosdb/models/CosmosDBAccountModel';
import { ConnectionDiagnosticsTab } from './ConnectionDiagnosticsTab';
import { type DiagnosticsRouterContext } from './trpc/routers/connectionDiagnosticsRouter';

const mocks = vi.hoisted(() => ({ attach: vi.fn(), assign: vi.fn() }));
vi.mock('@microsoft/vscode-ext-webview/host', () => ({
    attachTrpc: mocks.attach,
    default: { attachTrpc: mocks.attach },
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({}));
vi.mock('../connectionDiagnostics/run', () => ({ runDiagnostics: vi.fn() }));
vi.mock('../cosmosdb/utils/rbacUtils', () => ({ addRbacContributorPermission: mocks.assign }));
vi.mock('../utils/azureClients', () => ({}));
vi.mock('../extensionVariables', () => ({
    ext: { context: { extensionPath: 'C:\\extension', extensionMode: 1 }, isBundle: true },
}));
vi.mock('../Telemetry', () => ({
    TelemetryContext: class {
        addMaskedValue = vi.fn();
        reportWebviewEvent = vi.fn();
    },
}));
vi.mock('./trpc/routers/connectionDiagnosticsRouter', () => ({ connectionDiagnosticsRouter: {} }));
vi.mock('./trpc/trpc', () => ({ diagnosticsCallerFactory: {} }));

const account: CosmosDBAccountModel = {
    id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account',
    name: 'account',
    resourceGroup: 'rg',
    subscription: armTestSubscription,
    azureResourceType: { type: 'microsoft.documentdb/databaseaccounts' },
    raw: {},
};
const principal = '44c205ac-c76f-44ce-9212-04a60b429589';
const nextPrincipal = '44c205ac-c76f-44ce-9212-04a60b429590';
const panels: vscode.WebviewPanel[] = [];
const warningWindow: {
    showWarningMessage(
        message: string,
        options: vscode.MessageOptions,
        ...items: string[]
    ): Thenable<string | undefined>;
} = vscode.window;

function createPanel(_viewType: string, title: string): vscode.WebviewPanel {
    const disposed = new vscode.EventEmitter<void>();
    let closed = false;
    const panel = {
        title,
        webview: { html: '', cspSource: 'test-webview:', asWebviewUri: (uri: vscode.Uri) => uri },
        onDidDispose: disposed.event,
        dispose: () => {
            if (closed) return;
            closed = true;
            disposed.fire();
            disposed.dispose();
        },
    } as vscode.WebviewPanel;
    panels.push(panel);
    return panel;
}

function open() {
    ConnectionDiagnosticsTab.render({ kind: 'azure', account, probe: 'nosql' });
    const [panel, context] = mocks.attach.mock.lastCall as [vscode.WebviewPanel, DiagnosticsRouterContext];
    return { panel, context };
}

function finishRun(runId: string, recipient?: string) {
    const [, , publish, onPrincipal] = vi.mocked(runDiagnostics).mock.lastCall!;
    if (recipient) onPrincipal?.(recipient, account);
    publish({
        kind: 'azure',
        phase: 'completed',
        checks: recipient ? [{ step: 'access', finding: 'dataRbac', status: 'failed' }] : [],
        trace: { runId, lines: [] },
    } satisfies DiagnosticsState);
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.attach.mockReturnValue({ disposable: { dispose: vi.fn() } });
    vi.spyOn(vscode.window, 'createWebviewPanel').mockImplementation(createPanel);
});

afterEach(() => {
    for (const panel of panels.splice(0)) panel.dispose();
    vi.restoreAllMocks();
});

it('keeps the diagnostics webview alive when switching editor tabs', () => {
    open();

    expect(vi.mocked(vscode.window.createWebviewPanel).mock.lastCall?.[3]).toMatchObject({
        retainContextWhenHidden: true,
    });
    expect(runDiagnostics).toHaveBeenCalledOnce();
});

it('keeps local trace details off the webview state and clears them on rerun', () => {
    const { context } = open();
    const local = ['configured endpoint=https://account.example.test'];
    vi.mocked(runDiagnostics).mock.lastCall?.[4]?.(local);
    finishRun('run-one');

    expect(context.getLocalTrace()).toEqual(local);
    expect(JSON.stringify(context.getState())).not.toContain('account.example.test');
    context.rerun();
    expect(context.getLocalTrace()).toEqual([]);
});

it('allows only one concurrent role request and disables it after success', async () => {
    const { context } = open();
    finishRun('run-one', principal);
    const confirmation = Promise.withResolvers<string>();
    const prompt = vi.spyOn(warningWindow, 'showWarningMessage').mockReturnValue(confirmation.promise);
    const action = createArmTestContext();
    const first = context.addDataRole('run-one', action);

    await expect(context.addDataRole('run-one', action)).resolves.toBe('unavailable');
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.assign).not.toHaveBeenCalled();
    confirmation.resolve('Add Data Contributor role');
    await expect(first).resolves.toBe('assigned');
    expect(mocks.assign).toHaveBeenCalledOnce();
    expect(context.getState().canAddDataRole).toBe(false);
    await expect(context.addDataRole('run-one', action)).resolves.toBe('unavailable');
    expect(prompt).toHaveBeenCalledOnce();
});

it('does not carry a role recipient across runs or accept an old run ID for a new recipient', async () => {
    const { context } = open();
    const action = createArmTestContext();
    vi.spyOn(warningWindow, 'showWarningMessage').mockResolvedValue('Add Data Contributor role');
    finishRun('run-one', principal);
    expect(context.getState().canAddDataRole).toBe(true);

    context.rerun();
    await expect(context.addDataRole('run-one', action)).resolves.toBe('unavailable');
    finishRun('run-two');
    expect(context.getState().canAddDataRole).toBe(false);
    await expect(context.addDataRole('run-two', action)).resolves.toBe('unavailable');

    context.rerun();
    finishRun('run-three', nextPrincipal);
    await expect(context.addDataRole('run-one', action)).resolves.toBe('unavailable');
    expect(mocks.assign).not.toHaveBeenCalled();
    await expect(context.addDataRole('run-three', action)).resolves.toBe('assigned');
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith(
        account.name,
        nextPrincipal,
        account.resourceGroup,
        action,
        account.subscription,
        { idempotent: true },
    );
});

it('does not write when the tab closes while the confirmation is open', async () => {
    const { context, panel } = open();
    finishRun('run-one', principal);
    const confirmation = Promise.withResolvers<string>();
    vi.spyOn(warningWindow, 'showWarningMessage').mockReturnValue(confirmation.promise);
    const result = context.addDataRole('run-one', createArmTestContext());
    panel.dispose();
    confirmation.resolve('Add Data Contributor role');
    await expect(result).resolves.toBe('unavailable');
    expect(mocks.assign).not.toHaveBeenCalled();
});
