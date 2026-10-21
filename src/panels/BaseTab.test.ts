/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { BaseTab } from './BaseTab';
import { DocumentTab } from './DocumentTab';

const mocks = vi.hoisted(() => ({
    extensionMode: 1,
    attachTrpc: vi.fn(() => ({ disposable: { dispose: vi.fn() } })),
}));

vi.mock('../extensionVariables', () => ({
    ext: {
        isBundle: true,
        context: {
            extensionPath: '/synthetic-extension',
            get extensionMode() {
                return mocks.extensionMode;
            },
        },
    },
}));
vi.mock('../Telemetry', () => ({
    TelemetryContext: class {
        addMaskedValue = vi.fn();
        reportWebviewEvent = vi.fn().mockResolvedValue(undefined);
    },
}));
vi.mock('../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBKeyCredential: () => undefined }));
vi.mock('./trpc/appRouter', () => ({ documentAppRouter: {}, documentCallerFactory: {} }));
vi.mock('@microsoft/vscode-ext-webview/host', () => ({
    attachTrpc: mocks.attachTrpc,
    default: { attachTrpc: mocks.attachTrpc },
}));

class TestTab extends BaseTab {
    constructor(panel: vscode.WebviewPanel) {
        super(panel, 'testView');
    }
}

function createPanel(title: string): vscode.WebviewPanel {
    return {
        title,
        viewType: 'testView',
        active: true,
        visible: true,
        viewColumn: vscode.ViewColumn.Active,
        options: {},
        webview: {
            html: '',
            options: {},
            cspSource: 'https://webview.example.invalid',
            asWebviewUri: () => vscode.Uri.parse('https://webview.example.invalid/views.js'),
            onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
            postMessage: vi.fn().mockResolvedValue(true),
        },
        onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
        reveal: vi.fn(),
        dispose: vi.fn(),
    };
}

const tabs: BaseTab[] = [];

afterEach(() => {
    for (const tab of tabs.splice(0)) tab.dispose();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

describe.each([
    { name: 'production', extensionMode: vscode.ExtensionMode.Production, devServer: undefined },
    { name: 'development', extensionMode: vscode.ExtensionMode.Development, devServer: '1' },
])('BaseTab HTML in $name', ({ extensionMode, devServer }) => {
    beforeEach(() => {
        mocks.extensionMode = extensionMode;
        vi.stubEnv('DEVSERVER', devServer);
    });

    it.each([
        'ordinary item.json',
        'A & < > " \' &lt; &#39;.json',
        '</title><script>globalThis.__cwe79Marker = true</script><title>.json',
        '</TiTlE><img src="x" onerror="globalThis.__cwe79Marker = true"><title>.json',
        '</title><svg onload="globalThis.__cwe79Marker = true"></svg><title>.json',
        '</title><meta http-equiv="refresh" content="0;url=https://example.invalid"><title>.json',
    ])('preserves title text without introducing markup: %s', (title) => {
        const panel = createPanel(title);
        tabs.push(new TestTab(panel));

        const parsed = new DOMParser().parseFromString(panel.webview.html, 'text/html');
        const reparsed = new DOMParser().parseFromString(parsed.documentElement.outerHTML, 'text/html');
        for (const document of [parsed, reparsed]) {
            expect(document.querySelector('title')?.textContent).toBe(title);
            expect(document.querySelectorAll('title')).toHaveLength(1);
            expect(document.querySelectorAll('script')).toHaveLength(2);
            expect(document.querySelector('img, svg, iframe, [onerror], [onload]')).toBeNull();
            expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
        }
        expect(panel.title).toBe(title);
    });

    it('places CSP immediately after charset and preserves the nonced bootstrap', () => {
        const panel = createPanel('Document');
        tabs.push(new TestTab(panel));
        const document = new DOMParser().parseFromString(panel.webview.html, 'text/html');
        const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        expect(document.head.children[0].getAttribute('charset')).toBe('UTF-8');
        expect(document.head.children[1]).toBe(csp);

        const scripts = [...document.querySelectorAll('script')];
        expect(scripts).toHaveLength(2);
        const nonce = scripts[0].getAttribute('nonce');
        expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
        expect(scripts[1].getAttribute('nonce')).toBe(nonce);
        expect(csp?.getAttribute('content')).toContain(`'nonce-${nonce}'`);
        expect(scripts[0].textContent).toContain('globalThis.l10n_bundle');
        expect(scripts[1].textContent).toContain('render("testView", acquireVsCodeApi())');
        expect(document.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    });

    it('protects the real DocumentTab path without changing its native title or identifier', () => {
        const panel = createPanel('');
        vi.mocked(vscode.window.createWebviewPanel).mockImplementation((_viewType, title) => {
            panel.title = title;
            return panel;
        });
        const connection: NoSqlQueryConnection = {
            endpoint: 'https://cosmos.example.invalid',
            databaseId: 'db & name',
            containerId: 'container <name>',
            credentials: [],
            isEmulator: false,
        };
        const documentId = { id: '</title><script>globalThis.__cwe79Marker = true</script><title>' };
        tabs.push(DocumentTab.render(connection, 'view', documentId));
        const title = `${documentId.id}.json - ${connection.databaseId}/${connection.containerId}`;
        const document = new DOMParser().parseFromString(panel.webview.html, 'text/html');

        expect(panel.title).toBe(title);
        expect(document.querySelector('title')?.textContent).toBe(title);
        expect(document.querySelectorAll('script')).toHaveLength(2);
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
            DocumentTab.viewType,
            title,
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        expect(mocks.attachTrpc).toHaveBeenCalledWith(
            panel,
            expect.objectContaining({
                state: expect.objectContaining({ documentId, mode: 'view' }),
            }),
            {},
            {},
        );
    });

    it('does not regenerate HTML when the native panel title changes', () => {
        const panel = createPanel('Initial title');
        tabs.push(new TestTab(panel));
        const initialHtml = panel.webview.html;

        panel.title = '</title><script>globalThis.__cwe79Marker = true</script>';

        expect(panel.webview.html).toBe(initialHtml);
    });
});
