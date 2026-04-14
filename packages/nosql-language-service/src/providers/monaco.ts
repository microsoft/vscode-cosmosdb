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
import { type SqlLanguageService } from '../services/index.js';
import { type Disposable, DiagnosticSeverity as DsSeverity } from '../services/types.js';

// Declare timer APIs that exist in both Node.js and browsers
// without requiring DOM or @types/node lib references.
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

/**
 * The Monaco namespace type, equivalent to `typeof import('monaco-editor')`.
 */
export type MonacoNamespace = typeof monacoEditor;

// ========================== Public config =====================================

/** Language ID registered with Monaco. Override if you need a custom one. */
export const LANGUAGE_ID = 'cosmosdb-sql';

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
        monaco.languages.register({ id: langId });
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
