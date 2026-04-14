/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// VS Code extension provider adapter for @cosmosdb/nosql-language-service
//
// Usage (inside your extension's activate()):
//
//   import * as vscode from "vscode";
//   import { SqlLanguageService } from "@cosmosdb/nosql-language-service";
//   import { registerCosmosDbSql } from "@cosmosdb/nosql-language-service/vscode";
//
//   const service = new SqlLanguageService({ getSchema: () => schema });
//   const disposable = registerCosmosDbSql(vscode, service, context);
//
// This module does NOT import the "vscode" package — it accepts the
// vscode namespace as a runtime argument, keeping the core library
// free of Node/Electron dependencies.
// ---------------------------------------------------------------------------

import type * as vscodeApi from 'vscode';
import { type CompletionItemKind } from '../completion/SqlCompletion.js';
import { type SqlLanguageService } from '../services/index.js';
import { type Disposable, DiagnosticSeverity as DsSeverity } from '../services/types.js';

// Declare timer APIs that exist in both Node.js and browsers
// without requiring DOM or @types/node lib references.
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

/**
 * The VS Code API namespace type, equivalent to `typeof import('vscode')`.
 */
export type VSCodeNamespace = typeof vscodeApi;

// ========================== Public types ======================================

/** Document selector used to scope VS Code providers. */
export const LANGUAGE_ID = 'cosmosdb-sql';

export interface VSCodeRegistrationOptions {
    /**
     * Language ID to scope providers to.
     * @default "cosmosdb-sql"
     */
    languageId?: string;

    /**
     * Whether to register the completion provider.
     * @default true
     */
    completions?: boolean;

    /**
     * Whether to push diagnostics via a DiagnosticCollection.
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

export interface VSCodeDiagnosticsProviderOptions {
    /**
     * Language ID to watch.
     * @default "cosmosdb-sql"
     */
    languageId?: string;

    /**
     * Diagnostic collection name.
     * @default "cosmosdb-sql"
     */
    collectionName?: string;

    /**
     * Debounce delay (ms) for diagnostics on text changes.
     * @default 300
     */
    diagnosticDelay?: number;
}

// ========================== Hover provider ====================================

/**
 * Standalone hover provider for VS Code.
 *
 * Implements the `vscode.HoverProvider` interface. Can be used
 * independently via `vscode.languages.registerHoverProvider()`
 * or automatically through {@link registerCosmosDbSql}.
 *
 * @example
 * ```typescript
 * import { VSCodeHoverProvider } from "@cosmosdb/nosql-language-service/vscode";
 *
 * const provider = new VSCodeHoverProvider(vscode, service);
 * vscode.languages.registerHoverProvider(selector, provider);
 * ```
 */
export class VSCodeHoverProvider implements vscodeApi.HoverProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideHover(document: vscodeApi.TextDocument, position: vscodeApi.Position): vscodeApi.Hover | null {
        const query = document.getText();
        const offset = document.offsetAt(position);
        const info = this.service.getHoverInfo(query, offset);
        if (!info) return null;

        const md = new this.vscode.MarkdownString(info.contents.join('\n\n'), true);
        md.isTrusted = true;

        let range: vscodeApi.Range | undefined;
        if (info.range) {
            range = new this.vscode.Range(
                new this.vscode.Position(info.range.startLine - 1, info.range.startColumn - 1),
                new this.vscode.Position(info.range.endLine - 1, info.range.endColumn - 1),
            );
        }
        return new this.vscode.Hover(md, range);
    }
}

// ========================== Signature help provider ============================

/**
 * Standalone signature help provider for VS Code.
 *
 * Implements the `vscode.SignatureHelpProvider` interface.
 *
 * @example
 * ```typescript
 * import { VSCodeSignatureHelpProvider } from "@cosmosdb/nosql-language-service/vscode";
 *
 * const provider = new VSCodeSignatureHelpProvider(vscode, service);
 * vscode.languages.registerSignatureHelpProvider(selector, provider, "(", ",");
 * ```
 */
export class VSCodeSignatureHelpProvider implements vscodeApi.SignatureHelpProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideSignatureHelp(
        document: vscodeApi.TextDocument,
        position: vscodeApi.Position,
    ): vscodeApi.SignatureHelp | null {
        const query = document.getText();
        const offset = document.offsetAt(position);
        const result = this.service.getSignatureHelp(query, offset);
        if (!result) return null;

        const sh = new this.vscode.SignatureHelp();
        sh.activeSignature = result.activeSignature;
        sh.activeParameter = result.activeParameter;
        sh.signatures = result.signatures.map((sig) => {
            const si = new this.vscode.SignatureInformation(sig.label, sig.documentation);
            si.parameters = sig.parameters.map((p) => new this.vscode.ParameterInformation(p.label, p.documentation));
            return si;
        });
        return sh;
    }
}

// ========================== Completion provider ================================

/**
 * Standalone completion item provider for VS Code.
 *
 * Implements the `vscode.CompletionItemProvider` interface.
 *
 * @example
 * ```typescript
 * import { VSCodeCompletionProvider } from "@cosmosdb/nosql-language-service/vscode";
 *
 * const provider = new VSCodeCompletionProvider(vscode, service);
 * vscode.languages.registerCompletionItemProvider(selector, provider, ".", " ", ",");
 * ```
 */
export class VSCodeCompletionProvider implements vscodeApi.CompletionItemProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideCompletionItems(document: vscodeApi.TextDocument, position: vscodeApi.Position): vscodeApi.CompletionItem[] {
        const query = document.getText();
        const offset = document.offsetAt(position);
        const items = this.service.getCompletions(query, offset);

        return items.map((item) => {
            const ci = new this.vscode.CompletionItem(item.label, mapCompletionKind(this.vscode, item.kind));
            ci.detail = item.detail;
            ci.sortText = item.sortText;
            if (item.insertText) {
                ci.insertText = new this.vscode.SnippetString(item.insertText);
            }
            return ci;
        });
    }
}

// ========================== Formatting provider ================================

/**
 * Standalone document formatting provider for VS Code.
 *
 * Implements the `vscode.DocumentFormattingEditProvider` interface.
 *
 * @example
 * ```typescript
 * import { VSCodeFormattingProvider } from "@cosmosdb/nosql-language-service/vscode";
 *
 * const provider = new VSCodeFormattingProvider(vscode, service);
 * vscode.languages.registerDocumentFormattingEditProvider(selector, provider);
 * ```
 */
export class VSCodeFormattingProvider implements vscodeApi.DocumentFormattingEditProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideDocumentFormattingEdits(document: vscodeApi.TextDocument): vscodeApi.TextEdit[] {
        const query = document.getText();
        const edits = this.service.getFormatEdits(query);
        return edits.map((e) =>
            this.vscode.TextEdit.replace(
                new this.vscode.Range(
                    new this.vscode.Position(e.range.startLine - 1, e.range.startColumn - 1),
                    new this.vscode.Position(e.range.endLine - 1, e.range.endColumn - 1),
                ),
                e.newText,
            ),
        );
    }
}

// ========================== Diagnostics provider ================================

/**
 * Standalone diagnostics controller for VS Code.
 *
 * VS Code diagnostics are pushed through a `DiagnosticCollection` rather than
 * a `register*Provider()` API, so this class owns the collection and the
 * workspace listeners required to keep it up to date.
 *
 * @example
 * ```typescript
 * import { VSCodeDiagnosticsProvider } from "@cosmosdb/nosql-language-service/vscode";
 *
 * const diagnostics = new VSCodeDiagnosticsProvider(vscode, service, {
 *   languageId: "cosmosdb-sql",
 *   diagnosticDelay: 200,
 * });
 * context.subscriptions.push(diagnostics);
 * ```
 */
export class VSCodeDiagnosticsProvider implements Disposable {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;
    private readonly languageId: string;
    private readonly diagnosticDelay: number;
    private readonly collection: vscodeApi.DiagnosticCollection;
    private readonly disposables: Disposable[] = [];
    private readonly timers = new Map<string, number>();

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService, options: VSCodeDiagnosticsProviderOptions = {}) {
        this.vscode = vscode;
        this.service = service;
        this.languageId = options.languageId ?? LANGUAGE_ID;
        this.diagnosticDelay = options.diagnosticDelay ?? 300;
        this.collection = this.vscode.languages.createDiagnosticCollection(options.collectionName ?? 'cosmosdb-sql');

        this.disposables.push(this.collection);
        this.disposables.push(
            this.vscode.workspace.onDidChangeTextDocument((event: vscodeApi.TextDocumentChangeEvent) => {
                this.scheduleDiagnostics(event.document);
            }),
        );
        this.disposables.push(
            this.vscode.workspace.onDidOpenTextDocument((document: vscodeApi.TextDocument) => {
                this.pushDiagnostics(document);
            }),
        );
        this.disposables.push(
            this.vscode.workspace.onDidCloseTextDocument((document: vscodeApi.TextDocument) => {
                this.clearDiagnostics(document);
            }),
        );

        for (const document of this.vscode.workspace.textDocuments) {
            this.pushDiagnostics(document);
        }
    }

    dispose(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private scheduleDiagnostics(document: vscodeApi.TextDocument): void {
        if (document.languageId !== this.languageId) return;

        const key = String(document.uri);
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.timers.delete(key);
            this.pushDiagnostics(document);
        }, this.diagnosticDelay);

        this.timers.set(key, timer);
    }

    private clearDiagnostics(document: vscodeApi.TextDocument): void {
        const key = String(document.uri);
        const timer = this.timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(key);
        }

        this.collection.delete(document.uri);
    }

    private pushDiagnostics(document: vscodeApi.TextDocument): void {
        if (document.languageId !== this.languageId) return;

        const query = document.getText();
        const diags = this.service.getDiagnostics(query);

        this.collection.set(
            document.uri,
            diags.map((d) => {
                const range = new this.vscode.Range(
                    new this.vscode.Position(d.range.startLine - 1, d.range.startColumn - 1),
                    new this.vscode.Position(d.range.endLine - 1, d.range.endColumn - 1),
                );
                const diagnostic = new this.vscode.Diagnostic(range, d.message, mapSeverity(this.vscode, d.severity));
                diagnostic.code = d.code;
                diagnostic.source = d.source ?? 'cosmosdb-sql';
                return diagnostic;
            }),
        );
    }
}

// ========================== Registration ======================================

/**
 * Register CosmosDB NoSQL SQL language support with VS Code.
 * Returns a {@link Disposable} that unregisters everything.
 *
 * Uses the standalone provider classes ({@link VSCodeCompletionProvider},
 * {@link VSCodeHoverProvider}, {@link VSCodeSignatureHelpProvider},
 * {@link VSCodeFormattingProvider}) internally. You can also register
 * those classes directly if you need fine-grained control.
 *
 * @param vscode - The `vscode` module (`import * as vscode from "vscode"`).
 * @param service - A configured {@link SqlLanguageService}.
 * @param context - The extension context (subscriptions are auto-managed).
 * @param options - Feature flags and overrides.
 */
export function registerCosmosDbSql(
    vscode: VSCodeNamespace,
    service: SqlLanguageService,
    context?: { subscriptions: Disposable[] },
    options: VSCodeRegistrationOptions = {},
): Disposable {
    const langId = options.languageId ?? LANGUAGE_ID;
    const selector = { language: langId, scheme: '*' };
    const disposables: Disposable[] = [];

    // --- Completions --------------------------------------
    if (options.completions !== false) {
        disposables.push(
            vscode.languages.registerCompletionItemProvider(
                selector,
                new VSCodeCompletionProvider(vscode, service),
                '.',
                ' ',
                ',',
            ),
        );
    }

    // --- Diagnostics --------------------------------------
    if (options.diagnostics !== false) {
        disposables.push(
            new VSCodeDiagnosticsProvider(vscode, service, {
                languageId: langId,
                collectionName: 'cosmosdb-sql',
                diagnosticDelay: options.diagnosticDelay,
            }),
        );
    }

    // --- Hover --------------------------------------------
    if (options.hover !== false) {
        disposables.push(vscode.languages.registerHoverProvider(selector, new VSCodeHoverProvider(vscode, service)));
    }

    // --- Signature help -----------------------------------
    if (options.signatureHelp !== false) {
        disposables.push(
            vscode.languages.registerSignatureHelpProvider(
                selector,
                new VSCodeSignatureHelpProvider(vscode, service),
                '(',
                ',',
            ),
        );
    }

    // --- Formatting ---------------------------------------
    if (options.formatting !== false) {
        disposables.push(
            vscode.languages.registerDocumentFormattingEditProvider(
                selector,
                new VSCodeFormattingProvider(vscode, service),
            ),
        );
    }

    // --- Register all disposables with extension context --
    const composite: Disposable = {
        dispose() {
            for (const d of disposables) d.dispose();
            disposables.length = 0;
        },
    };

    if (context) {
        context.subscriptions.push(composite);
    }

    return composite;
}

// ========================== Kind mappers ======================================

function mapCompletionKind(vscode: VSCodeNamespace, kind: CompletionItemKind): vscodeApi.CompletionItemKind {
    switch (kind) {
        case 'keyword':
            return vscode.CompletionItemKind.Keyword;
        case 'field':
            return vscode.CompletionItemKind.Field;
        case 'function':
            return vscode.CompletionItemKind.Function;
        case 'snippet':
            return vscode.CompletionItemKind.Snippet;
        case 'alias':
            return vscode.CompletionItemKind.Variable;
        case 'parameter':
            return vscode.CompletionItemKind.Variable;
        default:
            return vscode.CompletionItemKind.Text;
    }
}

function mapSeverity(vscode: VSCodeNamespace, severity: DsSeverity): vscodeApi.DiagnosticSeverity {
    switch (severity) {
        case DsSeverity.Error:
            return vscode.DiagnosticSeverity.Error;
        case DsSeverity.Warning:
            return vscode.DiagnosticSeverity.Warning;
        case DsSeverity.Information:
            return vscode.DiagnosticSeverity.Information;
        case DsSeverity.Hint:
            return vscode.DiagnosticSeverity.Hint;
        default:
            return vscode.DiagnosticSeverity.Error;
    }
}
