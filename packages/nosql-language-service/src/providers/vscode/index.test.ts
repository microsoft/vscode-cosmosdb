/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscodeApi from 'vscode';
import {
    VSCodeCompletionProvider,
    VSCodeFoldingRangeProvider,
    VSCodeFormattingProvider,
    VSCodeHoverProvider,
    VSCodeSignatureHelpProvider,
    registerCosmosDbSql,
    type VSCodeNamespace,
} from './index.js';
import { SqlLanguageService } from '../../services/SqlLanguageService.js';

// ---------------------------------------------------------------------------
// Lightweight VS Code mock
// ---------------------------------------------------------------------------

function createVSCodeMock() {
    const registeredProviders: Record<string, any[]> = {
        completion: [],
        hover: [],
        signatureHelp: [],
        formatting: [],
    };
    const diagnosticCollections: any[] = [];
    const textDocuments: any[] = [];

    return {
        registeredProviders,
        languages: {
            registerCompletionItemProvider: vi.fn((_selector, provider, ..._triggers) => {
                registeredProviders.completion.push(provider);
                return { dispose: vi.fn() };
            }),
            registerHoverProvider: vi.fn((_selector, provider) => {
                registeredProviders.hover.push(provider);
                return { dispose: vi.fn() };
            }),
            registerSignatureHelpProvider: vi.fn((_selector, provider, ..._triggers) => {
                registeredProviders.signatureHelp.push(provider);
                return { dispose: vi.fn() };
            }),
            registerDocumentFormattingEditProvider: vi.fn((_selector, provider) => {
                registeredProviders.formatting.push(provider);
                return { dispose: vi.fn() };
            }),
            registerFoldingRangeProvider: vi.fn((_selector, _provider) => {
                return { dispose: vi.fn() };
            }),
            createDiagnosticCollection: vi.fn((_name: string) => {
                const items = new Map();
                const collection = {
                    set: vi.fn((uri, diags) => items.set(uri, diags)),
                    delete: vi.fn((uri) => items.delete(uri)),
                    dispose: vi.fn(),
                };
                diagnosticCollections.push(collection);
                return collection;
            }),
        },
        // VS Code exposes enums at the top-level namespace
        CompletionItemKind: {
            Keyword: 14,
            Field: 5,
            Function: 3,
            Snippet: 15,
            Variable: 6,
            Text: 1,
        },
        workspace: {
            onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
            onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
            onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
            textDocuments,
        },
        window: {
            createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
            onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
            activeTextEditor: undefined,
        },
        CompletionItem: class {
            label: string;
            kind: number;
            detail?: string;
            sortText?: string;
            insertText?: any;
            constructor(label: string, kind: number) {
                this.label = label;
                this.kind = kind;
            }
        },
        SnippetString: class {
            value: string;
            constructor(value: string) {
                this.value = value;
            }
        },
        MarkdownString: class {
            value: string;
            isTrusted = false;
            constructor(value: string, _supportThemeIcons?: boolean) {
                this.value = value;
            }
        },
        Hover: class {
            contents: any;
            range: any;
            constructor(contents: any, range?: any) {
                this.contents = contents;
                this.range = range;
            }
        },
        Range: class {
            start: any;
            end: any;
            constructor(start: any, end: any) {
                this.start = start;
                this.end = end;
            }
        },
        Position: class {
            line: number;
            character: number;
            constructor(line: number, character: number) {
                this.line = line;
                this.character = character;
            }
        },
        SignatureHelp: class {
            signatures: any[] = [];
            activeSignature = 0;
            activeParameter = 0;
        },
        SignatureInformation: class {
            label: string;
            documentation: any;
            parameters: any[] = [];
            constructor(label: string, documentation?: any) {
                this.label = label;
                this.documentation = documentation;
            }
        },
        ParameterInformation: class {
            label: string;
            documentation: any;
            constructor(label: string, documentation?: any) {
                this.label = label;
                this.documentation = documentation;
            }
        },
        TextEdit: {
            replace: (range: any, newText: string) => ({ range, newText }),
        },
        Diagnostic: class {
            range: any;
            message: string;
            severity: number;
            code?: string;
            source?: string;
            constructor(range: any, message: string, severity: number) {
                this.range = range;
                this.message = message;
                this.severity = severity;
            }
        },
        DiagnosticSeverity: {
            Error: 0,
            Warning: 1,
            Information: 2,
            Hint: 3,
        },
        FoldingRange: class {
            start: number;
            end: number;
            constructor(start: number, end: number) {
                this.start = start;
                this.end = end;
            }
        },
    } as unknown as VSCodeNamespace;
}

function createDocumentMock(text: string): vscodeApi.TextDocument {
    const lines = text.split('\n');
    return {
        getText: () => text,
        languageId: 'cosmosdb-sql',
        uri: 'file:///test.sql',
        offsetAt: (pos: any) => {
            let offset = 0;
            for (let i = 0; i < pos.line; i++) {
                offset += lines[i].length + 1;
            }
            return offset + pos.character;
        },
        positionAt: (offset: number) => {
            let remaining = offset;
            for (let i = 0; i < lines.length; i++) {
                if (remaining <= lines[i].length) {
                    return { line: i, character: remaining };
                }
                remaining -= lines[i].length + 1;
            }
            return { line: lines.length - 1, character: lines[lines.length - 1].length };
        },
    } as unknown as vscodeApi.TextDocument;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VSCodeHoverProvider', () => {
    let vscode: VSCodeNamespace;
    let service: SqlLanguageService;

    beforeEach(() => {
        vscode = createVSCodeMock();
        service = new SqlLanguageService();
    });

    it('returns Hover object for a known keyword', () => {
        const provider = new VSCodeHoverProvider(vscode, service);
        const doc = createDocumentMock('SELECT * FROM c');
        const result = provider.provideHover(doc, { line: 0, character: 2 } as unknown as vscodeApi.Position);

        expect(result).not.toBeNull();
        expect(result).toBeInstanceOf((vscode as any).Hover);
        expect((result as any).contents.value).toContain('SELECT');
    });

    it('returns Hover with range for a keyword', () => {
        const provider = new VSCodeHoverProvider(vscode, service);
        const doc = createDocumentMock('SELECT * FROM c');
        const result = provider.provideHover(doc, { line: 0, character: 2 } as unknown as vscodeApi.Position);

        expect(result).not.toBeNull();
        expect((result as any).range).toBeInstanceOf((vscode as any).Range);
    });

    it('returns null for unrecognized tokens', () => {
        const provider = new VSCodeHoverProvider(vscode, service);
        const doc = createDocumentMock('SELECT c.xyz FROM c');
        const result = provider.provideHover(doc, { line: 0, character: 10 } as unknown as vscodeApi.Position);

        expect(result).toBeNull();
    });
});

describe('VSCodeCompletionProvider', () => {
    let vscode: VSCodeNamespace;
    let service: SqlLanguageService;

    beforeEach(() => {
        vscode = createVSCodeMock();
        service = new SqlLanguageService();
    });

    it('returns CompletionItem instances', () => {
        const provider = new VSCodeCompletionProvider(vscode, service);
        const doc = createDocumentMock('SELECT ');
        const items = provider.provideCompletionItems(doc, {
            line: 0,
            character: 7,
        } as unknown as vscodeApi.Position);

        expect(items.length).toBeGreaterThan(0);
        expect(items[0]).toBeInstanceOf((vscode as any).CompletionItem);
    });
});

describe('VSCodeSignatureHelpProvider', () => {
    let vscode: VSCodeNamespace;
    let service: SqlLanguageService;

    beforeEach(() => {
        vscode = createVSCodeMock();
        service = new SqlLanguageService();
    });

    it('returns SignatureHelp inside a function call', () => {
        const provider = new VSCodeSignatureHelpProvider(vscode, service);
        const doc = createDocumentMock('SELECT CONTAINS(c.name, ');
        const result = provider.provideSignatureHelp(doc, {
            line: 0,
            character: 24,
        } as unknown as vscodeApi.Position);

        expect(result).not.toBeNull();
        expect(result).toBeInstanceOf((vscode as any).SignatureHelp);
        expect(result!.signatures.length).toBeGreaterThan(0);
        expect(result!.activeParameter).toBe(1);
    });

    it('returns null when not inside a function call', () => {
        const provider = new VSCodeSignatureHelpProvider(vscode, service);
        const doc = createDocumentMock('SELECT * FROM c');
        const result = provider.provideSignatureHelp(doc, {
            line: 0,
            character: 3,
        } as unknown as vscodeApi.Position);

        expect(result).toBeNull();
    });
});

describe('VSCodeFormattingProvider', () => {
    let vscode: VSCodeNamespace;
    let service: SqlLanguageService;

    beforeEach(() => {
        vscode = createVSCodeMock();
        service = new SqlLanguageService();
    });

    it('returns TextEdit array for unformatted query', () => {
        const provider = new VSCodeFormattingProvider(vscode, service);
        const doc = createDocumentMock('SELECT  *  FROM  c');
        const edits = provider.provideDocumentFormattingEdits(doc);

        expect(edits.length).toBeGreaterThan(0);
        expect(edits[0].newText).toBeDefined();
        expect(edits[0].range).toBeDefined();
    });

    it('returns empty array for already-formatted query', () => {
        const provider = new VSCodeFormattingProvider(vscode, service);
        const formatted = service.format('SELECT * FROM c');
        const doc = createDocumentMock(formatted);
        const edits = provider.provideDocumentFormattingEdits(doc);

        expect(edits).toHaveLength(0);
    });
});

describe('registerCosmosDbSql (VS Code)', () => {
    let vscode: VSCodeNamespace;
    let service: SqlLanguageService;

    beforeEach(() => {
        vscode = createVSCodeMock();
        service = new SqlLanguageService();
    });

    it('registers all providers by default', () => {
        const disposable = registerCosmosDbSql(vscode, service);

        expect(vscode.languages.registerCompletionItemProvider).toHaveBeenCalled();
        expect(vscode.languages.registerHoverProvider).toHaveBeenCalled();
        expect(vscode.languages.registerSignatureHelpProvider).toHaveBeenCalled();
        expect(vscode.languages.registerDocumentFormattingEditProvider).toHaveBeenCalled();
        expect(vscode.languages.createDiagnosticCollection).toHaveBeenCalled();
        expect(disposable.dispose).toBeDefined();
    });

    it('respects feature flags', () => {
        registerCosmosDbSql(vscode, service, undefined, {
            completions: false,
            hover: false,
            signatureHelp: false,
            formatting: false,
            diagnostics: false,
        });

        expect(vscode.languages.registerCompletionItemProvider).not.toHaveBeenCalled();
        expect(vscode.languages.registerHoverProvider).not.toHaveBeenCalled();
        expect(vscode.languages.registerSignatureHelpProvider).not.toHaveBeenCalled();
        expect(vscode.languages.registerDocumentFormattingEditProvider).not.toHaveBeenCalled();
        expect(vscode.languages.createDiagnosticCollection).not.toHaveBeenCalled();
    });

    it('adds composite disposable to context.subscriptions', () => {
        const context = { subscriptions: [] as any[] };
        registerCosmosDbSql(vscode, service, context);

        expect(context.subscriptions.length).toBe(1);
        expect(context.subscriptions[0].dispose).toBeDefined();
    });

    it('dispose is safe to call multiple times', () => {
        const disposable = registerCosmosDbSql(vscode, service);
        disposable.dispose();
        disposable.dispose();
    });
});

describe('VSCodeFoldingRangeProvider', () => {
    let vscode: VSCodeNamespace;
    let service: SqlLanguageService;

    beforeEach(() => {
        vscode = createVSCodeMock();
        service = new SqlLanguageService();
    });

    it('returns no folds for a single query', () => {
        const provider = new VSCodeFoldingRangeProvider(vscode, service);
        const doc = createDocumentMock('SELECT * FROM c');
        const ranges = provider.provideFoldingRanges(doc);
        expect(ranges).toHaveLength(0);
    });

    it('returns no folds for single-line queries separated by semicolons', () => {
        const provider = new VSCodeFoldingRangeProvider(vscode, service);
        const doc = createDocumentMock('SELECT * FROM c;\nSELECT * FROM d;');
        const ranges = provider.provideFoldingRanges(doc);
        expect(ranges).toHaveLength(0);
    });

    it('returns a fold for a multi-line query', () => {
        const provider = new VSCodeFoldingRangeProvider(vscode, service);
        const doc = createDocumentMock('SELECT * FROM c;\nSELECT\n*\nFROM d;');
        const ranges = provider.provideFoldingRanges(doc);
        expect(ranges).toHaveLength(1);
        // VSCode uses 0-based lines: SELECT on line 1, FROM d on line 3
        expect(ranges[0].start).toBe(1);
        expect(ranges[0].end).toBe(3);
    });

    it('fold range starts at content, not at previous semicolon', () => {
        const provider = new VSCodeFoldingRangeProvider(vscode, service);
        // Line 0: SELECT 1;
        // Line 1: (empty)
        // Line 2: SELECT
        // Line 3: *
        // Line 4: FROM c;
        const doc = createDocumentMock('SELECT 1;\n\nSELECT\n*\nFROM c;');
        const ranges = provider.provideFoldingRanges(doc);
        expect(ranges).toHaveLength(1);
        // Fold should start at line 2 (0-based), NOT line 0
        expect(ranges[0].start).toBe(2);
        expect(ranges[0].end).toBe(4);
    });
});

