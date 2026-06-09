/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { type CompletionItemKind } from '../../completion/SqlCompletion.js';
import { DiagnosticSeverity as DsSeverity } from '../../services/types.js';

/**
 * The Monaco namespace type, equivalent to `typeof import('monaco-editor')`.
 */
export type MonacoNamespace = typeof monacoEditor;

export interface MonacoRegistrationOptions {
    /**
     * Monaco language id to register providers against. Must match the id
     * declared in your `monaco.languages.register({ id })` (or will be
     * auto-registered if no language with this id exists yet).
     * @default "cosmosdb-sql"
     */
    languageId?: string;
    /**
     * Register the autocomplete provider (keywords, functions, schema fields,
     * aliases). Disable if your host already provides completions.
     * @default true
     */
    completions?: boolean;
    /**
     * Push parser errors and warnings as Monaco markers. Disable for read-only
     * viewers where you don't want the gutter to show squiggles.
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
     * Install the Monarch tokenizer and language configuration (brackets,
     * comments, auto-closing pairs). Disable if your host registers its own
     * tokenizer or uses a different syntax highlighter.
     * @default true
     */
    monarchTokenizer?: boolean;
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
     * Debounce (in ms) between the last edit and pushing diagnostic markers.
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

export interface MonacoDiagnosticsProviderOptions {
    /**
     * Monaco language id this provider should observe. Models with a
     * different language are ignored.
     * @default "cosmosdb-sql"
     */
    languageId?: string;
    /**
     * Marker `owner` string passed to `editor.setModelMarkers`. Use a
     * distinct owner per source so other markers on the same model aren't
     * wiped when this provider updates.
     * @default "cosmosdb-sql"
     */
    owner?: string;
    /**
     * Debounce (in ms) between the last edit and re-running diagnostics.
     * @default 300
     */
    diagnosticDelay?: number;
}

/**
 * Environment-agnostic timer ID type.
 */
export type TimerId = ReturnType<typeof globalThis.setTimeout>;

export function mapCompletionKind(
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

export function mapSeverity(monaco: MonacoNamespace, severity: DsSeverity): monacoEditor.MarkerSeverity {
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
