/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlLanguageService } from '../../services/SqlLanguageService.js';
import { VSCodeMultiQueryDecorator } from './multiQueryDecorator.js';
import { type VSCodeNamespace } from './types.js';

function makeEditor(text: string, cursorOffset = 0, languageId = 'cosmosdb-sql') {
    const lines = text.split('\n');
    const positionAt = (offset: number) => {
        let rem = offset;
        for (let i = 0; i < lines.length; i++) {
            if (rem <= lines[i].length) return { line: i, character: rem };
            rem -= lines[i].length + 1;
        }
        return { line: lines.length - 1, character: lines[lines.length - 1].length };
    };
    const offsetAt = (pos: { line: number; character: number }) => {
        let off = 0;
        for (let i = 0; i < pos.line; i++) off += lines[i].length + 1;
        return off + pos.character;
    };
    return {
        document: {
            languageId,
            getText: () => text,
            positionAt,
            offsetAt,
            lineCount: lines.length,
            lineAt: (line: number) => ({
                range: { start: { line, character: 0 }, end: { line, character: lines[line].length } },
            }),
        },
        selection: { active: positionAt(cursorOffset) },
        setDecorations: vi.fn(),
    };
}

function createVSCodeMock(activeEditor: ReturnType<typeof makeEditor> | undefined) {
    const decorationTypes: { dispose: ReturnType<typeof vi.fn> }[] = [];
    const listeners: {
        activeEditor?: (e: unknown) => void;
        selection?: (e: unknown) => void;
        changeDoc?: (e: unknown) => void;
    } = {};

    const vscode = {
        decorationTypes,
        listeners,
        window: {
            activeTextEditor: activeEditor,
            createTextEditorDecorationType: vi.fn(() => {
                const t = { dispose: vi.fn() };
                decorationTypes.push(t);
                return t;
            }),
            onDidChangeActiveTextEditor: vi.fn((cb: (e: unknown) => void) => {
                listeners.activeEditor = cb;
                return { dispose: vi.fn() };
            }),
            onDidChangeTextEditorSelection: vi.fn((cb: (e: unknown) => void) => {
                listeners.selection = cb;
                return { dispose: vi.fn() };
            }),
        },
        workspace: {
            onDidChangeTextDocument: vi.fn((cb: (e: unknown) => void) => {
                listeners.changeDoc = cb;
                return { dispose: vi.fn() };
            }),
            activeTextEditor: activeEditor,
        },
        Range: class {
            args: unknown[];
            constructor(...args: unknown[]) {
                this.args = args;
            }
        },
    };
    return vscode as unknown as VSCodeNamespace & typeof vscode;
}

const MULTI_QUERY = 'SELECT 1;\nSELECT 2;';
const SINGLE_QUERY = 'SELECT * FROM c';

describe('VSCodeMultiQueryDecorator', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates two decoration types and registers listeners', () => {
        const vscode = createVSCodeMock(undefined);
        new VSCodeMultiQueryDecorator(vscode, service);
        expect(vscode.window.createTextEditorDecorationType).toHaveBeenCalledTimes(2);
        expect(vscode.window.onDidChangeActiveTextEditor).toHaveBeenCalled();
        expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled();
        expect(vscode.window.onDidChangeTextEditorSelection).toHaveBeenCalled();
    });

    it('decorates separators and the active block for a multi-query editor', () => {
        // Cursor inside the second query (offset 12 ≈ "SELECT 2").
        const editor = makeEditor(MULTI_QUERY, 12);
        const vscode = createVSCodeMock(editor);
        new VSCodeMultiQueryDecorator(vscode, service);

        // setDecorations is called for both the separator type and the active-block type.
        expect(editor.setDecorations).toHaveBeenCalled();
        const separatorCall = editor.setDecorations.mock.calls.find((c) => c[0] === vscode.decorationTypes[0]);
        const activeCall = editor.setDecorations.mock.calls.find((c) => c[0] === vscode.decorationTypes[1]);
        expect(separatorCall).toBeDefined();
        expect(activeCall).toBeDefined();
        // One separator (the first ";") → one decorated range.
        expect((separatorCall![1] as unknown[]).length).toBeGreaterThan(0);
        // Active-block decorations cover every line.
        expect((activeCall![1] as unknown[]).length).toBe(MULTI_QUERY.split('\n').length);
    });

    it('clears active-block decorations for a single-query editor', () => {
        const editor = makeEditor(SINGLE_QUERY, 0);
        const vscode = createVSCodeMock(editor);
        new VSCodeMultiQueryDecorator(vscode, service);

        const activeCall = editor.setDecorations.mock.calls.find((c) => c[0] === vscode.decorationTypes[1]);
        expect(activeCall).toBeDefined();
        expect(activeCall![1]).toHaveLength(0);
    });

    it('does not highlight the active block when the option is disabled', () => {
        const editor = makeEditor(MULTI_QUERY, 12);
        const vscode = createVSCodeMock(editor);
        new VSCodeMultiQueryDecorator(vscode, service, { highlightActiveBlock: false });
        expect(vscode.window.onDidChangeTextEditorSelection).not.toHaveBeenCalled();
    });

    it('debounces redraws on document change', () => {
        vi.useFakeTimers();
        const editor = makeEditor(MULTI_QUERY, 12);
        const vscode = createVSCodeMock(editor);
        new VSCodeMultiQueryDecorator(vscode, service, { decorationDelay: 100 });
        editor.setDecorations.mockClear();

        vscode.listeners.changeDoc?.({ document: editor.document });
        expect(editor.setDecorations).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(editor.setDecorations).toHaveBeenCalled();
    });

    it('dispose tears down decoration types', () => {
        const editor = makeEditor(MULTI_QUERY, 12);
        const vscode = createVSCodeMock(editor);
        const decorator = new VSCodeMultiQueryDecorator(vscode, service);
        decorator.dispose();
        expect(vscode.decorationTypes[0].dispose).toHaveBeenCalled();
        expect(vscode.decorationTypes[1].dispose).toHaveBeenCalled();
    });
});
