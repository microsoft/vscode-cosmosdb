/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscodeApi from 'vscode';
import { SqlLanguageService } from '../../services/SqlLanguageService.js';
import { VSCodeDiagnosticsProvider } from './diagnosticsProvider.js';
import { type VSCodeNamespace } from './types.js';

interface Listeners {
    change?: (e: vscodeApi.TextDocumentChangeEvent) => void;
    open?: (d: vscodeApi.TextDocument) => void;
    close?: (d: vscodeApi.TextDocument) => void;
}

function createVSCodeMock() {
    const listeners: Listeners = {};
    const collection = {
        set: vi.fn(),
        delete: vi.fn(),
        dispose: vi.fn(),
    };
    const textDocuments: vscodeApi.TextDocument[] = [];

    const vscode = {
        collection,
        listeners,
        textDocuments,
        languages: {
            createDiagnosticCollection: vi.fn(() => collection),
        },
        workspace: {
            get textDocuments() {
                return textDocuments;
            },
            onDidChangeTextDocument: vi.fn((cb: Listeners['change']) => {
                listeners.change = cb;
                return { dispose: vi.fn() };
            }),
            onDidOpenTextDocument: vi.fn((cb: Listeners['open']) => {
                listeners.open = cb;
                return { dispose: vi.fn() };
            }),
            onDidCloseTextDocument: vi.fn((cb: Listeners['close']) => {
                listeners.close = cb;
                return { dispose: vi.fn() };
            }),
        },
        Range: class {
            constructor(
                public start: unknown,
                public end: unknown,
            ) {}
        },
        Position: class {
            constructor(
                public line: number,
                public character: number,
            ) {}
        },
        Diagnostic: class {
            code: unknown;
            source: string | undefined;
            constructor(
                public range: unknown,
                public message: string,
                public severity: number,
            ) {}
        },
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    };
    return vscode as unknown as VSCodeNamespace & typeof vscode;
}

function createDoc(text: string, languageId = 'cosmosdb-sql', uri = 'file:///t.sql'): vscodeApi.TextDocument {
    return { getText: () => text, languageId, uri } as unknown as vscodeApi.TextDocument;
}

const INVALID_QUERY = 'SELECT * FORM c';
const VALID_QUERY = 'SELECT * FROM c';

describe('VSCodeDiagnosticsProvider', () => {
    let vscode: ReturnType<typeof createVSCodeMock>;
    let service: SqlLanguageService;

    beforeEach(() => {
        vscode = createVSCodeMock();
        service = new SqlLanguageService();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates a diagnostic collection and registers listeners', () => {
        new VSCodeDiagnosticsProvider(vscode, service);
        expect(vscode.languages.createDiagnosticCollection).toHaveBeenCalled();
        expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled();
        expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalled();
        expect(vscode.workspace.onDidCloseTextDocument).toHaveBeenCalled();
    });

    it('publishes diagnostics for already-open documents on construction', () => {
        vscode.textDocuments.push(createDoc(INVALID_QUERY));
        new VSCodeDiagnosticsProvider(vscode, service);
        expect(vscode.collection.set).toHaveBeenCalledTimes(1);
        const [, diags] = vscode.collection.set.mock.calls[0];
        expect((diags as unknown[]).length).toBeGreaterThan(0);
        // diagnostic.code and source are populated from the language service result
        const first = (diags as { source?: string }[])[0];
        expect(first.source).toBe('cosmosdb-sql');
    });

    it('ignores documents whose languageId does not match', () => {
        vscode.textDocuments.push(createDoc(INVALID_QUERY, 'plaintext'));
        new VSCodeDiagnosticsProvider(vscode, service);
        expect(vscode.collection.set).not.toHaveBeenCalled();
    });

    it('pushes diagnostics when a matching document is opened', () => {
        new VSCodeDiagnosticsProvider(vscode, service);
        vscode.listeners.open?.(createDoc(VALID_QUERY));
        // valid query → empty diagnostics array, but still set on the collection
        expect(vscode.collection.set).toHaveBeenCalledTimes(1);
        const [, diags] = vscode.collection.set.mock.calls[0];
        expect(diags).toHaveLength(0);
    });

    it('debounces diagnostics on document change', () => {
        vi.useFakeTimers();
        new VSCodeDiagnosticsProvider(vscode, service, { diagnosticDelay: 100 });
        const doc = createDoc(INVALID_QUERY);
        vscode.listeners.change?.({ document: doc } as vscodeApi.TextDocumentChangeEvent);
        expect(vscode.collection.set).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(vscode.collection.set).toHaveBeenCalledTimes(1);
    });

    it('clears diagnostics when a document is closed', () => {
        new VSCodeDiagnosticsProvider(vscode, service);
        const doc = createDoc(VALID_QUERY);
        vscode.listeners.close?.(doc);
        expect(vscode.collection.delete).toHaveBeenCalledWith(doc.uri);
    });

    it('dispose clears timers and disposes the collection', () => {
        vi.useFakeTimers();
        const provider = new VSCodeDiagnosticsProvider(vscode, service, { diagnosticDelay: 100 });
        vscode.listeners.change?.({ document: createDoc(INVALID_QUERY) } as vscodeApi.TextDocumentChangeEvent);
        provider.dispose();
        // After dispose the pending timer must not fire.
        vi.advanceTimersByTime(200);
        expect(vscode.collection.set).not.toHaveBeenCalled();
        expect(vscode.collection.dispose).toHaveBeenCalled();
    });
});
