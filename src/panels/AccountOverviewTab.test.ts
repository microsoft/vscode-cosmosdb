/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../cosmosdb/AzureResourceMetadata';
import {
    ACCOUNT_OVERVIEW_TARGETS,
    type AccountOverviewNavigation,
    type AccountOverviewTarget,
} from './accountOverview/navigation';
import { AccountOverviewTab } from './AccountOverviewTab';
import { type AccountOverviewRouterContext } from './trpc/appRouter';

const mocks = vi.hoisted(() => ({
    attach: vi.fn(),
    mask: vi.fn(),
    event: vi.fn(),
}));

vi.mock('@microsoft/vscode-ext-webview/host', () => ({
    attachTrpc: mocks.attach,
    default: { attachTrpc: mocks.attach },
}));
vi.mock('./trpc/appRouter', () => ({ accountOverviewAppRouter: {}, accountOverviewCallerFactory: {} }));
vi.mock('../extensionVariables', () => ({
    ext: { context: { extensionPath: 'C:\\extension', extensionMode: 1 }, isBundle: true },
}));
vi.mock('../Telemetry', () => ({
    TelemetryContext: class {
        addMaskedValue = mocks.mask;
        reportWebviewEvent = mocks.event;
    },
}));

function metadata(accountId = 'account-1'): AzureResourceMetadata {
    return {
        accountId,
        accountName: 'same-display-name',
        resourceGroup: 'private-group',
        documentEndpoint: 'https://private.documents.azure.com',
        subscription: { subscriptionId: 'private-sub', tenantId: 'private-tenant', name: 'private-subscription' },
        databaseAccount: { name: 'same-display-name', location: 'private-region' },
        getClient: vi.fn(),
    } as unknown as AzureResourceMetadata;
}

function createPanel(_viewType: string, title: string): vscode.WebviewPanel {
    const disposed = new vscode.EventEmitter<void>();
    let closed = false;
    return {
        title,
        webview: {
            html: '',
            cspSource: 'test-webview:',
            asWebviewUri: (uri: vscode.Uri) => uri,
        },
        reveal: vi.fn(),
        onDidDispose: disposed.event,
        dispose: vi.fn(() => {
            if (!closed) {
                closed = true;
                disposed.fire();
                disposed.dispose();
            }
        }),
    } as unknown as vscode.WebviewPanel;
}

function attached(index = 0) {
    const [panel, context] = mocks.attach.mock.calls[index] as [vscode.WebviewPanel, AccountOverviewRouterContext];
    return { panel, context };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.attach.mockReset().mockImplementation(() => ({ disposable: { dispose: vi.fn() } }));
    vi.spyOn(vscode.window, 'createWebviewPanel').mockImplementation(createPanel);
});

afterEach(() => {
    for (const tab of AccountOverviewTab.openTabs) {
        tab.dispose();
    }
    vi.restoreAllMocks();
});

describe('AccountOverviewTab navigation', () => {
    it('opens the existing Account Overview webview at overview by default', () => {
        AccountOverviewTab.render(metadata());
        const { panel, context } = attached();
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
            'cosmosDbAccountOverview',
            'Account Overview',
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        expect(panel.title).toBe('Account Overview: same-display-name');
        expect(panel.webview.html).toContain('render("cosmosDbAccountOverview", acquireVsCodeApi())');
        expect(context.getInitialization()).toEqual({ type: 'navigate', target: 'overview', revision: 0 });
        expect(context).not.toHaveProperty('openPage');
        expect(context).not.toHaveProperty('openPortalPage');
    });

    it.each(ACCOUNT_OVERVIEW_TARGETS)('initializes a fresh panel directly at %s', (target) => {
        AccountOverviewTab.render(metadata(), vscode.ViewColumn.Two, target);
        expect(attached().context.getInitialization()).toEqual({ type: 'navigate', target, revision: 0 });
        expect(attached().panel.title).toBe('Account Overview: same-display-name');
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
            AccountOverviewTab.viewType,
            AccountOverviewTab.title,
            vscode.ViewColumn.Two,
            expect.any(Object),
        );
    });

    it('reuses one case-insensitive account panel for overview, every metric, and advisories', () => {
        const tab = AccountOverviewTab.render(metadata('ACCOUNT-1'));
        const { panel, context } = attached();
        const navigations: AccountOverviewNavigation[] = [];
        context.onNavigation((navigation) => navigations.push(navigation));

        for (const [index, target] of ACCOUNT_OVERVIEW_TARGETS.entries()) {
            expect(AccountOverviewTab.render(metadata('account-1'), vscode.ViewColumn.Beside, target)).toBe(tab);
            expect(context.getInitialization()).toEqual({ type: 'navigate', target, revision: index + 1 });
            expect(panel.title).toBe('Account Overview: same-display-name');
        }

        expect(navigations).toEqual(
            ACCOUNT_OVERVIEW_TARGETS.map((target, index) => ({ type: 'navigate', target, revision: index + 1 })),
        );
        expect(panel.reveal).toHaveBeenCalledTimes(ACCOUNT_OVERVIEW_TARGETS.length);
        expect(panel.reveal).toHaveBeenLastCalledWith(vscode.ViewColumn.Beside);
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
        expect(mocks.attach).toHaveBeenCalledTimes(1);
        expect(AccountOverviewTab.openTabs.size).toBe(1);
    });

    it('increments revisions and emits even when the same target is selected again', () => {
        const value = metadata();
        AccountOverviewTab.render(value, undefined, 'normalizedRu');
        const { context } = attached();
        const initial = context.getInitialization();
        const listener = vi.fn();
        context.onNavigation(listener);
        AccountOverviewTab.render(value, undefined, 'normalizedRu');
        const previous = context.getInitialization();
        AccountOverviewTab.render(value, undefined, 'normalizedRu');

        expect(initial).toEqual({ type: 'navigate', target: 'normalizedRu', revision: 0 });
        expect(previous).toEqual({ type: 'navigate', target: 'normalizedRu', revision: 1 });
        expect(listener.mock.calls).toEqual([
            [{ type: 'navigate', target: 'normalizedRu', revision: 1 }],
            [{ type: 'navigate', target: 'normalizedRu', revision: 2 }],
        ]);
        expect(context.getInitialization()).not.toBe(previous);
    });

    it('keeps different account IDs independent even with the same display name', () => {
        const first = AccountOverviewTab.render(metadata('account-1'));
        const second = AccountOverviewTab.render(metadata('account-2'), undefined, 'advisories');
        const secondListener = vi.fn();
        attached(1).context.onNavigation(secondListener);

        expect(AccountOverviewTab.render(metadata('ACCOUNT-1'), undefined, 'documentCount')).toBe(first);
        expect(second).not.toBe(first);
        expect(AccountOverviewTab.openTabs.size).toBe(2);
        expect(attached(1).context.getInitialization()).toEqual({
            type: 'navigate',
            target: 'advisories',
            revision: 0,
        });
        expect(secondListener).not.toHaveBeenCalled();
        expect(attached(1).panel.reveal).not.toHaveBeenCalled();
    });

    it('refreshes metadata and authentication before notifying the existing transport', () => {
        const original = metadata('ACCOUNT-1');
        const current = Object.assign(metadata('account-1'), {
            accountName: 'renamed-account',
            subscription: { ...original.subscription, tenantId: 'current-tenant' },
        });
        const tab = AccountOverviewTab.render(original);
        const { context, panel } = attached();
        // The transport shallow-copies context for each operation; existing operations keep their original metadata.
        const inFlight = { ...context };
        const listener = vi.fn(() => ({ metadata: { ...context }.metadata, title: panel.title }));
        context.onNavigation(listener);

        expect(AccountOverviewTab.render(current, undefined, 'advisories')).toBe(tab);
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveReturnedWith({ metadata: current, title: 'Account Overview: renamed-account' });
        expect(inFlight.metadata).toBe(original);
        expect({ ...context }.metadata).toBe(current);
        expect({ ...context }.metadata.getClient).toBe(current.getClient);
        expect(context.metadata.subscription.tenantId).toBe('current-tenant');
        expect(mocks.attach).toHaveBeenCalledTimes(1);
        expect(mocks.mask).toHaveBeenLastCalledWith(expect.arrayContaining(['renamed-account']));
        expect(mocks.mask.mock.calls.flat(2)).not.toContain('current-tenant');
    });

    it('removes a disposed panel and its listeners, preserves other accounts, and permits reopening', () => {
        const first = AccountOverviewTab.render(metadata());
        const sibling = AccountOverviewTab.render(metadata('account-2'));
        const { context, panel } = attached();
        const transport = mocks.attach.mock.results[0].value as { disposable: vscode.Disposable };
        const listener = vi.fn();
        context.onNavigation(listener);

        panel.dispose();
        first.dispose();
        expect(first.isDisposed).toBe(true);
        expect(transport.disposable.dispose).toHaveBeenCalledTimes(1);
        expect(AccountOverviewTab.openTabs.has(first)).toBe(false);
        expect(AccountOverviewTab.openTabs.has(sibling)).toBe(true);

        const reopened = AccountOverviewTab.render(metadata(), undefined, 'totalRequests');
        expect(reopened).not.toBe(first);
        expect(attached(2).context.getInitialization()).toEqual({
            type: 'navigate',
            target: 'totalRequests',
            revision: 0,
        });
        AccountOverviewTab.render(metadata(), undefined, 'advisories');
        expect(listener).not.toHaveBeenCalled();
        expect(AccountOverviewTab.openTabs.size).toBe(2);
    });

    it('cleans up failed transport attachment and can retry after disposal without losing another account', () => {
        const original = AccountOverviewTab.render(metadata());
        const sibling = AccountOverviewTab.render(metadata('account-2'));
        original.dispose();
        mocks.attach.mockImplementationOnce(() => {
            throw new Error('transport unavailable');
        });

        expect(() => AccountOverviewTab.render(metadata(), undefined, 'advisories')).toThrow('transport unavailable');
        expect(attached(2).panel.dispose).toHaveBeenCalledTimes(1);
        expect([...AccountOverviewTab.openTabs]).toEqual([sibling]);

        const retry = AccountOverviewTab.render(metadata(), undefined, 'advisories');
        expect(retry.isDisposed).toBe(false);
        expect(AccountOverviewTab.openTabs.has(retry)).toBe(true);
        expect(AccountOverviewTab.openTabs.size).toBe(2);
        expect(attached(3).context.getInitialization().revision).toBe(0);
    });

    it('rejects an invalid runtime destination before creating or changing a panel', () => {
        const invalid = 'throughput' as AccountOverviewTarget;
        expect(() => AccountOverviewTab.render(metadata(), undefined, invalid)).toThrow(
            'Invalid Account Overview destination.',
        );
        expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
        AccountOverviewTab.render(metadata());
        const { context, panel } = attached();
        const listener = vi.fn();
        context.onNavigation(listener);
        expect(() => AccountOverviewTab.render(metadata(), undefined, invalid)).toThrow(
            'Invalid Account Overview destination.',
        );
        expect(context.getInitialization()).toEqual({ type: 'navigate', target: 'overview', revision: 0 });
        expect(listener).not.toHaveBeenCalled();
        expect(panel.reveal).not.toHaveBeenCalled();
    });

    it('masks account error-path values without explicitly masking tenants or emitting resource identities', () => {
        AccountOverviewTab.render(metadata()).dispose();
        const masks = mocks.mask.mock.calls.flat(2) as string[];
        expect(masks).toEqual(
            expect.arrayContaining([
                'account-1',
                'same-display-name',
                'private-group',
                'private-sub',
                'private-subscription',
                'private.documents.azure.com',
            ]),
        );
        expect(masks).not.toContain('private-tenant');
        expect(masks.every((value) => value.trim().length > 0)).toBe(true);
        const events = JSON.stringify(mocks.event.mock.calls);
        expect(events).not.toContain('account-1');
        expect(events).not.toContain('same-display-name');
        expect(events).not.toContain('private-');
    });
});
