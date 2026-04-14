/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MonacoCompletionProvider,
    MonacoFormattingProvider,
    MonacoHoverProvider,
    MonacoSignatureHelpProvider,
    registerCosmosDbSql,
    type MonacoNamespace,
} from '../../src/providers/monaco.js';
import { SqlLanguageService } from '../../src/services/SqlLanguageService.js';

// ---------------------------------------------------------------------------
// Lightweight Monaco mock
// ---------------------------------------------------------------------------

function createMonacoMock(): MonacoNamespace {
    const registeredProviders: Record<string, any[]> = {
        completion: [],
        hover: [],
        signatureHelp: [],
        formatting: [],
    };
    const models: any[] = [];
    const modelCreateListeners: any[] = [];

    return {
        registeredProviders,
        languages: {
            getLanguages: () => [],
            register: vi.fn(),
            registerCompletionItemProvider: vi.fn((_langId, provider) => {
                registeredProviders.completion.push(provider);
                return { dispose: vi.fn() };
            }),
            registerHoverProvider: vi.fn((_langId, provider) => {
                registeredProviders.hover.push(provider);
                return { dispose: vi.fn() };
            }),
            registerSignatureHelpProvider: vi.fn((_langId, provider) => {
                registeredProviders.signatureHelp.push(provider);
                return { dispose: vi.fn() };
            }),
            registerDocumentFormattingEditProvider: vi.fn((_langId, provider) => {
                registeredProviders.formatting.push(provider);
                return { dispose: vi.fn() };
            }),
            CompletionItemKind: {
                Keyword: 17,
                Field: 4,
                Function: 1,
                Snippet: 27,
                Variable: 5,
                Text: 18,
            },
            CompletionItemInsertTextRule: {
                InsertAsSnippet: 4,
            },
        },
        editor: {
            getModels: () => models,
            setModelMarkers: vi.fn(),
            onDidCreateModel: vi.fn((cb) => {
                modelCreateListeners.push(cb);
                return { dispose: vi.fn() };
            }),
        },
        MarkerSeverity: {
            Error: 8,
            Warning: 4,
            Info: 2,
            Hint: 1,
        },
    } as unknown as MonacoNamespace;
}

function createModelMock(text: string): monacoEditor.editor.ITextModel {
    const lines = text.split('\n');
    return {
        getValue: () => text,
        getLanguageId: () => 'cosmosdb-sql',
        getOffsetAt: (pos: any) => {
            let offset = 0;
            for (let i = 0; i < pos.lineNumber - 1; i++) {
                offset += lines[i].length + 1;
            }
            return offset + pos.column - 1;
        },
        getWordUntilPosition: (pos: any) => ({
            startColumn: 1,
            endColumn: pos.column,
        }),
    } as unknown as monacoEditor.editor.ITextModel;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MonacoHoverProvider', () => {
    let monaco: ReturnType<typeof createMonacoMock>;
    let service: SqlLanguageService;

    beforeEach(() => {
        monaco = createMonacoMock();
        service = new SqlLanguageService();
    });

    it('returns hover for a known keyword', () => {
        const provider = new MonacoHoverProvider(monaco, service);
        const model = createModelMock('SELECT * FROM c');
        const result = provider.provideHover(model, {
            lineNumber: 1,
            column: 3,
        } as unknown as monacoEditor.Position);

        expect(result).not.toBeNull();
        expect(result!.contents.length).toBeGreaterThan(0);
        expect((result!.contents[0] as any).value).toContain('SELECT');
        expect((result!.contents[0] as any).isTrusted).toBe(true);
    });

    it('returns hover for a built-in function', () => {
        const provider = new MonacoHoverProvider(monaco, service);
        const model = createModelMock('SELECT COUNT(1) FROM c');
        const result = provider.provideHover(model, {
            lineNumber: 1,
            column: 9,
        } as unknown as monacoEditor.Position);

        expect(result).not.toBeNull();
        expect(result!.contents.length).toBeGreaterThan(0);
    });

    it('returns null for unrecognized tokens', () => {
        const provider = new MonacoHoverProvider(monaco, service);
        const model = createModelMock('SELECT c.xyz FROM c');
        const result = provider.provideHover(model, {
            lineNumber: 1,
            column: 11,
        } as unknown as monacoEditor.Position);

        expect(result).toBeNull();
    });

    it('includes range information', () => {
        const provider = new MonacoHoverProvider(monaco, service);
        const model = createModelMock('SELECT * FROM c');
        const result = provider.provideHover(model, {
            lineNumber: 1,
            column: 3,
        } as unknown as monacoEditor.Position);

        expect(result).not.toBeNull();
        expect(result!.range).toBeDefined();
        expect(result!.range!.startLineNumber).toBe(1);
        expect(result!.range!.startColumn).toBe(1);
    });
});

describe('MonacoCompletionProvider', () => {
    let monaco: ReturnType<typeof createMonacoMock>;
    let service: SqlLanguageService;

    beforeEach(() => {
        monaco = createMonacoMock();
        service = new SqlLanguageService();
    });

    it('has trigger characters defined', () => {
        const provider = new MonacoCompletionProvider(monaco, service);
        expect(provider.triggerCharacters).toEqual(['.', ' ', ',']);
    });

    it('returns completions for a partial query', () => {
        const provider = new MonacoCompletionProvider(monaco, service);
        const model = createModelMock('SELECT ');
        const result = provider.provideCompletionItems(model, {
            lineNumber: 1,
            column: 8,
        } as unknown as monacoEditor.Position);

        expect(result.suggestions).toBeDefined();
        expect(result.suggestions.length).toBeGreaterThan(0);
    });
});

describe('MonacoSignatureHelpProvider', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('has trigger/retrigger characters', () => {
        const provider = new MonacoSignatureHelpProvider(service);
        expect(provider.signatureHelpTriggerCharacters).toContain('(');
        expect(provider.signatureHelpRetriggerCharacters).toContain(',');
    });

    it('returns signature help inside a function call', () => {
        const provider = new MonacoSignatureHelpProvider(service);
        const model = createModelMock('SELECT CONTAINS(c.name, ');
        const result = provider.provideSignatureHelp(model, {
            lineNumber: 1,
            column: 25,
        } as unknown as monacoEditor.Position);

        expect(result).not.toBeNull();
        expect(result!.value.signatures.length).toBeGreaterThan(0);
        expect(result!.value.activeParameter).toBe(1);
    });

    it('returns null when not in a function call', () => {
        const provider = new MonacoSignatureHelpProvider(service);
        const model = createModelMock('SELECT * FROM c');
        const result = provider.provideSignatureHelp(model, {
            lineNumber: 1,
            column: 3,
        } as unknown as monacoEditor.Position);

        expect(result).toBeNull();
    });
});

describe('MonacoFormattingProvider', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns formatting edits for a valid query', () => {
        const provider = new MonacoFormattingProvider(service);
        const model = createModelMock('SELECT  *  FROM  c');
        const edits = provider.provideDocumentFormattingEdits(model);

        expect(edits.length).toBeGreaterThan(0);
        expect(edits[0].range).toBeDefined();
        expect(edits[0].text).toBeDefined();
    });

    it('returns empty edits for already-formatted query', () => {
        const provider = new MonacoFormattingProvider(service);
        const formatted = service.format('SELECT * FROM c');
        const model = createModelMock(formatted);
        const edits = provider.provideDocumentFormattingEdits(model);

        expect(edits).toHaveLength(0);
    });
});

describe('registerCosmosDbSql (Monaco)', () => {
    let monaco: ReturnType<typeof createMonacoMock>;
    let service: SqlLanguageService;

    beforeEach(() => {
        monaco = createMonacoMock();
        service = new SqlLanguageService();
    });

    it('registers all providers by default', () => {
        const disposable = registerCosmosDbSql(monaco, service);

        expect(monaco.languages.register).toHaveBeenCalled();
        expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalled();
        expect(monaco.languages.registerHoverProvider).toHaveBeenCalled();
        expect(monaco.languages.registerSignatureHelpProvider).toHaveBeenCalled();
        expect(monaco.languages.registerDocumentFormattingEditProvider).toHaveBeenCalled();
        expect(disposable.dispose).toBeDefined();
    });

    it('respects feature flags', () => {
        registerCosmosDbSql(monaco, service, {
            completions: false,
            hover: false,
            signatureHelp: false,
            formatting: false,
            diagnostics: false,
        });

        expect(monaco.languages.registerCompletionItemProvider).not.toHaveBeenCalled();
        expect(monaco.languages.registerHoverProvider).not.toHaveBeenCalled();
        expect(monaco.languages.registerSignatureHelpProvider).not.toHaveBeenCalled();
        expect(monaco.languages.registerDocumentFormattingEditProvider).not.toHaveBeenCalled();
    });

    it('dispose cleans up all registrations', () => {
        const disposable = registerCosmosDbSql(monaco, service);
        disposable.dispose();
        // After disposal, a second dispose should be safe (no-op)
        disposable.dispose();
    });
});
