/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Monaco Editor provider adapter for @cosmosdb/nosql-language-service
//
// Usage:
//   import { SqlLanguageService } from "@cosmosdb/nosql-language-service";
//   import { registerCosmosDbSql } from "@cosmosdb/nosql-language-service/monaco";
//
//   const service = new SqlLanguageService({ getSchema: () => mySchema });
//   const disposable = registerCosmosDbSql(Monaco, service);
//   // later: disposable.dispose();
//
// This module does NOT import "monaco-editor" — it accepts the
// Monaco namespace as a runtime argument, so it works with any
// bundling setup (webpack, vite, cdn, electron, etc.).
// ---------------------------------------------------------------------------

import type * as monacoEditor from 'monaco-editor';
import { type CompletionItemKind } from '../completion/SqlCompletion.js';
import { FUNCTION_SIGNATURES, type SqlLanguageService } from '../services/index.js';
import { type Disposable, DiagnosticSeverity as DsSeverity } from '../services/types.js';
import { LANGUAGE_ID } from './shared.js';

// Declare timer APIs that exist in both Node.js and browsers
// without requiring DOM or @types/node lib references.
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

/**
 * The Monaco namespace type, equivalent to `typeof import('monaco-editor')`.
 */
export type MonacoNamespace = typeof monacoEditor;

// Re-export so consumers can still import from this module.
export { LANGUAGE_ID } from './shared.js';

export interface MonacoRegistrationOptions {
    /**
     * Language ID to register under.
     * @default "cosmosdb-sql"
     */
    languageId?: string;

    /**
     * Whether to register the completion provider.
     * @default true
     */
    completions?: boolean;

    /**
     * Whether to push diagnostics on content change.
     * @default true
     */
    diagnostics?: boolean;

    /**
     * Whether to register the hover provider.
     * @default true
     */
    hover?: boolean;

    /**
     * Whether to register the signature help provider.
     * @default true
     */
    signatureHelp?: boolean;

    /**
     * Whether to register the document formatting provider.
     * @default true
     */
    formatting?: boolean;

    /**
     * Whether to register the Monarch tokenizer for syntax highlighting
     * and the language configuration (brackets, comments, auto-closing pairs).
     *
     * When `true`, the language is registered with Monaco along with a
     * Monarch tokenizer that highlights keywords, built-in functions,
     * operators, strings, numbers, and comments.
     *
     * @default true
     */
    monarchTokenizer?: boolean;

    /**
     * Debounce delay (ms) for diagnostics on content change.
     * @default 300
     */
    diagnosticDelay?: number;
}

export interface MonacoDiagnosticsProviderOptions {
    /**
     * Language ID to watch.
     * @default "cosmosdb-sql"
     */
    languageId?: string;

    /**
     * Marker owner name used in `setModelMarkers`.
     * @default "cosmosdb-sql"
     */
    owner?: string;

    /**
     * Debounce delay (ms) for diagnostics on content change.
     * @default 300
     */
    diagnosticDelay?: number;
}

// ========================== Hover provider ====================================

/**
 * Standalone hover provider for Monaco Editor.
 *
 * Can be used independently via
 * `monaco.languages.registerHoverProvider(langId, new MonacoHoverProvider(service))`
 * or automatically through {@link registerCosmosDbSql}.
 *
 * @example
 * ```typescript
 * import { MonacoHoverProvider } from "@cosmosdb/nosql-language-service/monaco";
 *
 * const provider = new MonacoHoverProvider(monaco, service);
 * monaco.languages.registerHoverProvider("cosmosdb-sql", provider);
 * ```
 */
export class MonacoHoverProvider implements monacoEditor.languages.HoverProvider {
    private readonly service: SqlLanguageService;

    constructor(_monaco: MonacoNamespace, service: SqlLanguageService) {
        this.service = service;
    }

    provideHover(
        model: monacoEditor.editor.ITextModel,
        position: monacoEditor.Position,
    ): monacoEditor.languages.Hover | null {
        const query = model.getValue();
        const offset = model.getOffsetAt(position);
        const info = this.service.getHoverInfo(query, offset);
        if (!info) return null;

        return {
            contents: info.contents.map((c) => ({
                value: c,
                isTrusted: true,
            })),
            range: info.range
                ? {
                      startLineNumber: info.range.startLine,
                      startColumn: info.range.startColumn,
                      endLineNumber: info.range.endLine,
                      endColumn: info.range.endColumn,
                  }
                : undefined,
        };
    }
}

// ========================== Signature help provider ============================

/**
 * Standalone signature help provider for Monaco Editor.
 *
 * @example
 * ```typescript
 * import { MonacoSignatureHelpProvider } from "@cosmosdb/nosql-language-service/monaco";
 *
 * const provider = new MonacoSignatureHelpProvider(service);
 * monaco.languages.registerSignatureHelpProvider("cosmosdb-sql", provider);
 * ```
 */
export class MonacoSignatureHelpProvider implements monacoEditor.languages.SignatureHelpProvider {
    readonly signatureHelpTriggerCharacters = ['(', ','];
    readonly signatureHelpRetriggerCharacters = [','];
    private readonly service: SqlLanguageService;

    constructor(service: SqlLanguageService) {
        this.service = service;
    }

    provideSignatureHelp(
        model: monacoEditor.editor.ITextModel,
        position: monacoEditor.Position,
    ): monacoEditor.languages.SignatureHelpResult | null {
        const query = model.getValue();
        const offset = model.getOffsetAt(position);
        const result = this.service.getSignatureHelp(query, offset);
        if (!result) return null;

        return {
            value: {
                signatures: result.signatures.map((sig) => ({
                    label: sig.label,
                    documentation: sig.documentation ? { value: sig.documentation, isTrusted: true } : undefined,
                    parameters: sig.parameters.map((p) => ({
                        label: p.label,
                        documentation: p.documentation ? { value: p.documentation, isTrusted: true } : undefined,
                    })),
                })),
                activeSignature: result.activeSignature,
                activeParameter: result.activeParameter,
            },
            dispose() {},
        };
    }
}

// ========================== Completion provider ================================

/**
 * Standalone completion item provider for Monaco Editor.
 *
 * @example
 * ```typescript
 * import { MonacoCompletionProvider } from "@cosmosdb/nosql-language-service/monaco";
 *
 * const provider = new MonacoCompletionProvider(monaco, service);
 * monaco.languages.registerCompletionItemProvider("cosmosdb-sql", provider);
 * ```
 */
export class MonacoCompletionProvider implements monacoEditor.languages.CompletionItemProvider {
    readonly triggerCharacters = ['.', ' ', ','];
    private readonly monaco: MonacoNamespace;
    private readonly service: SqlLanguageService;

    constructor(monaco: MonacoNamespace, service: SqlLanguageService) {
        this.monaco = monaco;
        this.service = service;
    }

    provideCompletionItems(
        model: monacoEditor.editor.ITextModel,
        position: monacoEditor.Position,
    ): monacoEditor.languages.CompletionList {
        const query = model.getValue();
        const offset = model.getOffsetAt(position);
        const items = this.service.getCompletions(query, offset);

        const wordInfo = model.getWordUntilPosition(position);
        const range: monacoEditor.IRange = {
            startLineNumber: position.lineNumber,
            startColumn: wordInfo.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: wordInfo.endColumn,
        };

        return {
            suggestions: items.map((item) => ({
                label: item.label,
                kind: mapCompletionKind(this.monaco, item.kind),
                detail: item.detail,
                insertText: item.insertText ?? item.label,
                insertTextRules: item.insertText?.includes('$0')
                    ? this.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                    : undefined,
                sortText: item.sortText,
                range,
            })),
        };
    }
}

// ========================== Formatting provider ================================

/**
 * Standalone document formatting provider for Monaco Editor.
 *
 * @example
 * ```typescript
 * import { MonacoFormattingProvider } from "@cosmosdb/nosql-language-service/monaco";
 *
 * const provider = new MonacoFormattingProvider(service);
 * monaco.languages.registerDocumentFormattingEditProvider("cosmosdb-sql", provider);
 * ```
 */
export class MonacoFormattingProvider implements monacoEditor.languages.DocumentFormattingEditProvider {
    private readonly service: SqlLanguageService;

    constructor(service: SqlLanguageService) {
        this.service = service;
    }

    provideDocumentFormattingEdits(model: monacoEditor.editor.ITextModel): monacoEditor.languages.TextEdit[] {
        const query = model.getValue();
        const edits = this.service.getFormatEdits(query);
        return edits.map((e) => ({
            range: {
                startLineNumber: e.range.startLine,
                startColumn: e.range.startColumn,
                endLineNumber: e.range.endLine,
                endColumn: e.range.endColumn,
            },
            text: e.newText,
        }));
    }
}

// ========================== Diagnostics provider ================================

/**
 * Standalone diagnostics controller for Monaco Editor.
 *
 * Monaco diagnostics are pushed via `editor.setModelMarkers()` rather than a
 * `languages.register*Provider()` API, so this class manages model listeners
 * and marker updates for a language.
 *
 * @example
 * ```typescript
 * import { MonacoDiagnosticsProvider } from "@cosmosdb/nosql-language-service/monaco";
 *
 * const diagnostics = new MonacoDiagnosticsProvider(monaco, service, {
 *   languageId: "cosmosdb-sql",
 *   diagnosticDelay: 200,
 * });
 *
 * // later
 * diagnostics.dispose();
 * ```
 */
export class MonacoDiagnosticsProvider implements Disposable {
    private readonly monaco: MonacoNamespace;
    private readonly service: SqlLanguageService;
    private readonly languageId: string;
    private readonly owner: string;
    private readonly diagnosticDelay: number;
    private readonly timers = new Map<monacoEditor.editor.ITextModel, number>();
    private readonly modelDisposables = new Map<monacoEditor.editor.ITextModel, Disposable[]>();
    private readonly rootDisposables: Disposable[] = [];

    constructor(monaco: MonacoNamespace, service: SqlLanguageService, options: MonacoDiagnosticsProviderOptions = {}) {
        this.monaco = monaco;
        this.service = service;
        this.languageId = options.languageId ?? LANGUAGE_ID;
        this.owner = options.owner ?? 'cosmosdb-sql';
        this.diagnosticDelay = options.diagnosticDelay ?? 300;

        this.rootDisposables.push(
            this.monaco.editor.onDidCreateModel((model: monacoEditor.editor.ITextModel) => {
                this.observeModel(model);
            }),
        );

        if (typeof this.monaco.editor.onDidChangeModelLanguage === 'function') {
            this.rootDisposables.push(
                this.monaco.editor.onDidChangeModelLanguage(
                    (event: { model: monacoEditor.editor.ITextModel; oldLanguage: string }) => {
                        this.unobserveModel(event.model);
                        this.observeModel(event.model);
                    },
                ),
            );
        }

        for (const model of this.monaco.editor.getModels()) {
            this.observeModel(model);
        }
    }

    dispose(): void {
        for (const model of Array.from(this.modelDisposables.keys())) {
            this.unobserveModel(model);
        }

        for (const disposable of this.rootDisposables) {
            disposable.dispose();
        }
        this.rootDisposables.length = 0;
    }

    private observeModel(model: monacoEditor.editor.ITextModel): void {
        if (model.getLanguageId() !== this.languageId) return;
        if (this.modelDisposables.has(model)) return;

        this.pushDiagnostics(model);

        const disposables: Disposable[] = [];
        disposables.push(
            model.onDidChangeContent(() => {
                this.scheduleDiagnostics(model);
            }),
        );
        disposables.push(
            model.onWillDispose(() => {
                this.unobserveModel(model);
            }),
        );

        this.modelDisposables.set(model, disposables);
    }

    private unobserveModel(model: monacoEditor.editor.ITextModel): void {
        const disposables = this.modelDisposables.get(model);
        if (disposables) {
            for (const disposable of disposables) {
                disposable.dispose();
            }
            this.modelDisposables.delete(model);
        }

        const timer = this.timers.get(model);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(model);
        }

        if (typeof model.getLanguageId === 'function' && model.getLanguageId() === this.languageId) {
            this.monaco.editor.setModelMarkers(model, this.owner, []);
        }
    }

    private scheduleDiagnostics(model: monacoEditor.editor.ITextModel): void {
        const existing = this.timers.get(model);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.timers.delete(model);
            this.pushDiagnostics(model);
        }, this.diagnosticDelay);

        this.timers.set(model, timer);
    }

    private pushDiagnostics(model: monacoEditor.editor.ITextModel): void {
        const query = model.getValue();
        const diags = this.service.getDiagnostics(query);
        const markers = diags.map((d) => ({
            severity: mapSeverity(this.monaco, d.severity),
            message: d.message,
            startLineNumber: d.range.startLine,
            startColumn: d.range.startColumn,
            endLineNumber: d.range.endLine,
            endColumn: d.range.endColumn,
            code: d.code,
            source: d.source,
        }));
        this.monaco.editor.setModelMarkers(model, this.owner, markers);
    }
}

// ========================== Monarch tokenizer =================================

/**
 * SQL keywords for Monarch tokenization.
 * Derived from the Chevrotain token set in `lexer/tokens.ts`.
 */
const MONARCH_KEYWORDS = [
    'AND',
    'ARRAY',
    'AS',
    'ASC',
    'BETWEEN',
    'BY',
    'CASE',
    'CAST',
    'CONVERT',
    'CROSS',
    'DESC',
    'DISTINCT',
    'ELSE',
    'END',
    'ESCAPE',
    'EXISTS',
    'FALSE',
    'FOR',
    'FROM',
    'GROUP',
    'HAVING',
    'IN',
    'INNER',
    'INSERT',
    'INTO',
    'IS',
    'JOIN',
    'LEFT',
    'LET',
    'LIKE',
    'LIMIT',
    'NOT',
    'NULL',
    'OFFSET',
    'ON',
    'OR',
    'ORDER',
    'OUTER',
    'OVER',
    'RANK',
    'RIGHT',
    'SELECT',
    'SET',
    'THEN',
    'TOP',
    'TRUE',
    'UDF',
    'UNDEFINED',
    'UPDATE',
    'VALUE',
    'WHEN',
    'WHERE',
    'WITH',
];

/** Word-based operators (checked before keywords so themes can color them differently). */
const MONARCH_OPERATORS = ['AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'LIKE', 'EXISTS'];

/** Built-in function names, derived from the language service's function signatures. */
const MONARCH_BUILTIN_FUNCTIONS = Object.keys(FUNCTION_SIGNATURES);

/**
 * Monaco language configuration for bracket matching, comments, and auto-closing pairs.
 *
 * Can be used standalone or is automatically applied by {@link registerCosmosDbSql}
 * when `monarchTokenizer` is not `false`.
 */
export const cosmosDbSqlLanguageConfiguration: monacoEditor.languages.LanguageConfiguration = {
    comments: {
        lineComment: '--',
        blockComment: ['/*', '*/'],
    },
    brackets: [
        ['[', ']'],
        ['(', ')'],
    ],
    autoClosingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"', notIn: ['string', 'comment'] },
        { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
    ],
};

/**
 * Monarch tokenizer for CosmosDB NoSQL query language.
 *
 * Provides syntax highlighting for:
 * - SQL-like clauses: SELECT, FROM, WHERE, ORDER BY, GROUP BY, etc.
 * - CosmosDB-specific keywords: VALUE, UNDEFINED, BETWEEN, EXISTS, RANK, etc.
 * - Built-in functions (aggregate, string, math, type-checking, date/time, etc.)
 * - Operators, hex/float/integer numbers, strings, identifiers, and quoted identifiers.
 * - Comments: line comments (`--`) and block comments.
 *
 * Can be used standalone via `monaco.languages.setMonarchTokensProvider()`
 * or automatically through {@link registerCosmosDbSql}.
 */
export const cosmosDbSqlMonarchTokensProvider: monacoEditor.languages.IMonarchLanguage = {
    defaultToken: '',
    ignoreCase: true,
    tokenPostfix: '.nosql',

    brackets: [
        { open: '[', close: ']', token: 'delimiter.square' },
        { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],

    keywords: [...MONARCH_KEYWORDS],
    operators: [...MONARCH_OPERATORS],
    builtinFunctions: [...MONARCH_BUILTIN_FUNCTIONS],

    tokenizer: {
        root: [
            { include: '@comments' },
            { include: '@whitespace' },
            { include: '@numbers' },
            { include: '@strings' },

            [/[()[\]]/, '@brackets'],
            [/[,;.]/, 'delimiter'],

            // Multi-char operators: comparison, null coalescing, string concat, bitwise shifts
            [/>>>|>>|<<|\|\||[<>]=?|!=|<>|\?\?/, 'operator'],
            // Arithmetic and bitwise: + - * / % & | ^ ~
            [/[+\-*/%&|^~]/, 'operator'],

            [
                /[a-zA-Z_]\w*/,
                {
                    cases: {
                        '@operators': 'operator',
                        '@keywords': 'keyword',
                        '@builtinFunctions': 'support.function',
                        '@default': 'identifier',
                    },
                },
            ],
        ],

        comments: [
            [/--+.*$/, 'comment'],
            [/\/\*/, 'comment', '@blockComment'],
        ],

        blockComment: [
            [/[^*/]+/, 'comment'],
            [/\*\//, 'comment', '@pop'],
            [/[*/]/, 'comment'],
        ],

        whitespace: [[/\s+/, 'white']],

        numbers: [
            [/0[xX][0-9a-fA-F]+/, 'number.hex'],
            [/\d+\.\d*([eE][-+]?\d+)?/, 'number.float'],
            [/\d+[eE][-+]?\d+/, 'number.float'],
            [/\d+/, 'number'],
        ],

        strings: [
            [/"/, 'string.quoted', '@quotedIdentifier'],
            [/'/, 'string', '@singleQuotedString'],
        ],

        quotedIdentifier: [
            [/[^"\\]+/, 'string.quoted'],
            [/\\./, 'string.escape'],
            [/"/, 'string.quoted', '@pop'],
        ],

        singleQuotedString: [
            [/[^'\\]+/, 'string'],
            [/\\./, 'string.escape'],
            [/''/, 'string.escape'], // SQL-style escaped single quote
            [/'/, 'string', '@pop'],
        ],
    },
};

// ========================== Folding range provider =============================

/**
 * Provides folding ranges for multi-query documents.
 * Each non-empty query region (between semicolons) becomes a foldable region.
 */
export class MonacoFoldingRangeProvider implements monacoEditor.languages.FoldingRangeProvider {
    private readonly service: SqlLanguageService;

    constructor(service: SqlLanguageService) {
        this.service = service;
    }

    provideFoldingRanges(model: monacoEditor.editor.ITextModel): monacoEditor.languages.FoldingRange[] {
        const text = model.getValue();
        const foldable = this.service.getFoldableRegions(text);

        const ranges: monacoEditor.languages.FoldingRange[] = [];
        for (const region of foldable) {
            const startPos = model.getPositionAt(region.contentStartOffset);
            const endPos = model.getPositionAt(region.contentEndOffset);
            if (endPos.lineNumber > startPos.lineNumber) {
                ranges.push({
                    start: startPos.lineNumber,
                    end: endPos.lineNumber,
                });
            }
        }
        return ranges;
    }
}

// ========================== Multi-query decorator ==============================

/**
 * CSS class name for the separator line between query regions.
 * Consumers can style this class in their CSS:
 * ```css
 * .cosmosdb-query-separator {
 *   border-bottom: 1px solid var(--vscode-editorIndentGuide-background, #404040);
 * }
 * ```
 */
const SEPARATOR_CLASS = 'cosmosdb-query-separator';

/**
 * Injects a `<style>` element with the default separator CSS rule.
 * Only injects once per document, identified by a data attribute.
 */
function ensureSeparatorStyles(): void {
    /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
    const g = globalThis as any;
    if (!g?.document?.createElement) return;
    const STYLE_ID = 'cosmosdb-multiquery-styles';
    if (g.document.getElementById(STYLE_ID)) return;
    const style = g.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
        `.${SEPARATOR_CLASS} {`,
        `  border-bottom: 2px solid var(--vscode-editorIndentGuide-activeBackground, var(--vscode-editorIndentGuide-background, #606060));`,
        `}`,
    ].join('\n');
    g.document.head.appendChild(style);
    /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
}

/**
 * Manages visual decorations for multi-query documents in Monaco:
 * - Thin horizontal separator lines between query regions
 *
 * Listens for content changes and cursor movements, updating
 * decorations automatically.
 */
export class MonacoMultiQueryDecorator implements Disposable {
    private readonly service: SqlLanguageService;
    private readonly disposables: Disposable[] = [];
    private decorations: monacoEditor.editor.IEditorDecorationsCollection | null = null;
    private editor: monacoEditor.editor.IStandaloneCodeEditor | null = null;
    private viewZoneIds: string[] = [];

    constructor(
        monaco: MonacoNamespace,
        service: SqlLanguageService,
        options: { languageId?: string; decorationDelay?: number; separatorSpacing?: number } = {},
    ) {
        this.service = service;
        const languageId = options.languageId ?? LANGUAGE_ID;
        const delay = options.decorationDelay ?? 300;

        ensureSeparatorStyles();

        const attachToEditor = (editor: monacoEditor.editor.ICodeEditor) => {
            if (this.editor) return; // already attached
            const codeEditor = editor as monacoEditor.editor.IStandaloneCodeEditor;
            if (typeof codeEditor.getModel !== 'function') return;
            const model = codeEditor.getModel();
            if (!model || model.getLanguageId() !== languageId) return;

            this.editor = codeEditor;
            this.decorations = codeEditor.createDecorationsCollection();
            this.updateDecorations();

            let timer: number | undefined;
            const scheduleUpdate = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = undefined;
                    this.updateDecorations();
                }, delay) as unknown as number;
            };

            this.disposables.push(model.onDidChangeContent(() => scheduleUpdate()));
        };

        const tryAttachAll = () => {
            if (this.editor) return;
            if (typeof monaco.editor.getEditors === 'function') {
                for (const existing of monaco.editor.getEditors()) {
                    attachToEditor(existing);
                }
            }
        };

        // Listen to editor creation to attach per-editor listeners
        this.disposables.push(monaco.editor.onDidCreateEditor((editor) => {
            // The editor may be created with a different language initially;
            // try now and also schedule a retry for after the model is set.
            attachToEditor(editor);
            if (!this.editor) {
                setTimeout(() => attachToEditor(editor), 100);
            }
        }));

        // When a model is created or language changes, re-check editors
        this.disposables.push(monaco.editor.onDidCreateModel(() => tryAttachAll()));
        if (typeof monaco.editor.onDidChangeModelLanguage === 'function') {
            this.disposables.push(monaco.editor.onDidChangeModelLanguage(() => tryAttachAll()));
        }

        // Also check already-existing editors (the editor may have been
        // created before this decorator was instantiated — common in React
        // where useEffect fires after the child <MonacoEditor> mounts).
        tryAttachAll();
    }

    private updateDecorations(): void {
        const editor = this.editor;
        if (!editor || !this.decorations) return;
        const model = editor.getModel();
        if (!model) return;

        const text = model.getValue();
        const separators = this.service.getSeparatorPositions(text);

        const newDecorations: monacoEditor.editor.IModelDeltaDecoration[] = [];
        const separatorLineNumbers: number[] = [];

        for (const sep of separators) {
            const endPos = model.getPositionAt(sep.semicolonOffset);
            separatorLineNumbers.push(endPos.lineNumber);
            newDecorations.push({
                range: {
                    startLineNumber: endPos.lineNumber,
                    startColumn: 1,
                    endLineNumber: endPos.lineNumber,
                    endColumn: model.getLineMaxColumn(endPos.lineNumber),
                },
                options: {
                    isWholeLine: true,
                    className: SEPARATOR_CLASS,
                    stickiness: 1, // NeverGrowsWhenTypingAtEdges
                },
            });
        }

        this.decorations.set(newDecorations);

        // Add view zones to create visual spacing after each separator line
        editor.changeViewZones((accessor) => {
            // Remove old view zones
            for (const id of this.viewZoneIds) {
                accessor.removeZone(id);
            }
            this.viewZoneIds = [];

            // Add new view zones
            for (const lineNumber of separatorLineNumbers) {
                const id = accessor.addZone({
                    afterLineNumber: lineNumber,
                    heightInLines: 0.5,
                    /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
                    domNode: (() => {
                        const g = globalThis as any;
                        const node = g?.document?.createElement?.('div');
                        if (node) {
                            node.style.pointerEvents = 'none';
                        }
                        return node ?? g?.document?.createElement?.('div');
                    })(),
                    /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
                });
                this.viewZoneIds.push(id);
            }
        });
    }

    dispose(): void {
        this.decorations?.clear();
        this.decorations = null;
        if (this.editor && this.viewZoneIds.length > 0) {
            const ids = this.viewZoneIds;
            this.editor.changeViewZones((accessor) => {
                for (const id of ids) {
                    accessor.removeZone(id);
                }
            });
        }
        this.viewZoneIds = [];
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
    }
}

// ========================== Registration =====================================

/**
 * Register CosmosDB NoSQL SQL language support in a Monaco editor
 * instance. Returns a {@link Disposable} that unregisters everything.
 *
 * Uses the standalone provider classes ({@link MonacoCompletionProvider},
 * {@link MonacoHoverProvider}, {@link MonacoSignatureHelpProvider},
 * {@link MonacoFormattingProvider}) internally. You can also register
 * those classes directly if you need fine-grained control.
 *
 * @param monaco - The `monaco` global namespace (from
 *   `import * as monaco from "monaco-editor"` or `window.monaco`).
 * @param service - A configured {@link SqlLanguageService}.
 * @param options - Feature flags and overrides.
 */
export function registerCosmosDbSql(
    monaco: MonacoNamespace,
    service: SqlLanguageService,
    options: MonacoRegistrationOptions = {},
): Disposable {
    const langId = options.languageId ?? LANGUAGE_ID;
    const disposables: Disposable[] = [];

    // Register language (if not already registered)
    const languages = monaco.languages.getLanguages();
    if (!languages.some((l) => l.id === langId)) {
        monaco.languages.register({
            id: langId,
            extensions: ['.nosql'],
            aliases: ['CosmosDB NoSQL', langId],
        });
    }

    // --- Monarch tokenizer (syntax highlighting) ----------
    if (options.monarchTokenizer !== false) {
        monaco.languages.setLanguageConfiguration(langId, cosmosDbSqlLanguageConfiguration);
        monaco.languages.setMonarchTokensProvider(langId, cosmosDbSqlMonarchTokensProvider);
    }

    // --- Completions --------------------------------------
    if (options.completions !== false) {
        disposables.push(
            monaco.languages.registerCompletionItemProvider(langId, new MonacoCompletionProvider(monaco, service)),
        );
    }

    // --- Diagnostics --------------------------------------
    if (options.diagnostics !== false) {
        disposables.push(
            new MonacoDiagnosticsProvider(monaco, service, {
                languageId: langId,
                owner: 'cosmosdb-sql',
                diagnosticDelay: options.diagnosticDelay,
            }),
        );
    }

    // --- Hover --------------------------------------------
    if (options.hover !== false) {
        disposables.push(monaco.languages.registerHoverProvider(langId, new MonacoHoverProvider(monaco, service)));
    }

    // --- Signature help -----------------------------------
    if (options.signatureHelp !== false) {
        disposables.push(
            monaco.languages.registerSignatureHelpProvider(langId, new MonacoSignatureHelpProvider(service)),
        );
    }

    // --- Formatting ---------------------------------------
    if (options.formatting !== false) {
        disposables.push(
            monaco.languages.registerDocumentFormattingEditProvider(langId, new MonacoFormattingProvider(service)),
        );
    }

    // --- Multi-query visual enhancements ------------------
    // Auto-register folding and separator decorations when the service has multiQuery enabled
    disposables.push(monaco.languages.registerFoldingRangeProvider(langId, new MonacoFoldingRangeProvider(service)));
    disposables.push(
        new MonacoMultiQueryDecorator(monaco, service, {
            languageId: langId,
            decorationDelay: options.diagnosticDelay,
        }),
    );

    // --- Composite disposable -----------------------------
    return {
        dispose() {
            for (const d of disposables) d.dispose();
            disposables.length = 0;
        },
    };
}

// ========================== Kind mappers =====================================

function mapCompletionKind(
    monaco: MonacoNamespace,
    kind: CompletionItemKind,
): monacoEditor.languages.CompletionItemKind {
    switch (kind) {
        case 'keyword':
            return monaco.languages.CompletionItemKind.Keyword;
        case 'field':
            return monaco.languages.CompletionItemKind.Field;
        case 'function':
            return monaco.languages.CompletionItemKind.Function;
        case 'snippet':
            return monaco.languages.CompletionItemKind.Snippet;
        case 'alias':
            return monaco.languages.CompletionItemKind.Variable;
        case 'parameter':
            return monaco.languages.CompletionItemKind.Variable;
        default:
            return monaco.languages.CompletionItemKind.Text;
    }
}

function mapSeverity(monaco: MonacoNamespace, severity: DsSeverity): monacoEditor.MarkerSeverity {
    switch (severity) {
        case DsSeverity.Error:
            return monaco.MarkerSeverity.Error;
        case DsSeverity.Warning:
            return monaco.MarkerSeverity.Warning;
        case DsSeverity.Information:
            return monaco.MarkerSeverity.Info;
        case DsSeverity.Hint:
            return monaco.MarkerSeverity.Hint;
        default:
            return monaco.MarkerSeverity.Error;
    }
}
