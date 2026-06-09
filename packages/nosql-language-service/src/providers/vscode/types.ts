/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeApi from 'vscode';
import { type CompletionItemKind } from '../../completion/SqlCompletion.js';
import { DiagnosticSeverity as DsSeverity } from '../../services/types.js';

/**
 * The VS Code API namespace type, equivalent to `typeof import('vscode')`.
 */
export type VSCodeNamespace = typeof vscodeApi;

export interface VSCodeRegistrationOptions {
    /**
     * VS Code language id to register providers against. Must match the
     * language contribution in your extension's `package.json`.
     * @default "cosmosdb-sql"
     */
    languageId?: string;
    /**
     * Register the autocomplete provider (keywords, functions, schema fields,
     * aliases). Disable if your extension already provides completions.
     * @default true
     */
    completions?: boolean;
    /**
     * Publish parser errors and warnings to a diagnostic collection. Disable
     * for read-only viewers where you don't want squiggles in the Problems
     * panel.
     * @default true
     */
    diagnostics?: boolean;
    /**
     * Register hover documentation for keywords, functions, and schema fields.
     * @default true
     */
    hover?: boolean;
    /**
     * Register function signature help (parameter hints) while typing inside
     * a function call.
     * @default true
     */
    signatureHelp?: boolean;
    /**
     * Register the document formatter (`Format Document` command and
     * `editor.formatOnSave` integration).
     * @default true
     */
    formatting?: boolean;
    /**
     * Register the folding-range provider for multi-query documents.
     * Each semicolon-separated query becomes a foldable region.
     * @default service.multiQuery
     */
    folding?: boolean;
    /**
     * Render multi-query separator lines and the active-block bar in the gutter.
     * @default service.multiQuery
     */
    multiQueryDecorations?: boolean;
    /**
     * Highlight the query block under the cursor.
     * Only relevant when `multiQueryDecorations` is enabled.
     * @default true
     */
    highlightActiveBlock?: boolean;
    /**
     * Debounce (in ms) between the last edit and pushing diagnostics.
     * Higher values reduce parser load on continuous typing; lower values
     * make errors appear faster.
     * @default 300
     */
    diagnosticDelay?: number;
    /**
     * Debounce (in ms) for redrawing multi-query decorations after edits.
     * Falls back to `diagnosticDelay` so both pipelines stay in lockstep
     * unless you explicitly want them different.
     * @default diagnosticDelay ?? 300
     */
    decorationDelay?: number;
}

export interface VSCodeDiagnosticsProviderOptions {
    /**
     * VS Code language id this provider should observe. Documents with a
     * different language are ignored.
     * @default "cosmosdb-sql"
     */
    languageId?: string;
    /**
     * Name of the `DiagnosticCollection` created for these diagnostics.
     * Use a distinct name per source so other diagnostics on the same
     * document aren't wiped when this provider updates.
     * @default "cosmosdb-sql"
     */
    collectionName?: string;
    /**
     * Debounce (in ms) between the last edit and re-running diagnostics.
     * @default 300
     */
    diagnosticDelay?: number;
}

/**
 * Environment-agnostic timer ID type.
 * Works in both Node.js (where setTimeout returns a Timeout object)
 * and browsers (where it returns a number).
 */
export type TimerId = ReturnType<typeof globalThis.setTimeout>;

export function mapCompletionKind(vscode: VSCodeNamespace, kind: CompletionItemKind): vscodeApi.CompletionItemKind {
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

export function mapSeverity(vscode: VSCodeNamespace, severity: DsSeverity): vscodeApi.DiagnosticSeverity {
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
