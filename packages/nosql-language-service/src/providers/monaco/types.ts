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
    /** @default "cosmosdb-sql" */
    languageId?: string;
    /** @default true */
    completions?: boolean;
    /** @default true */
    diagnostics?: boolean;
    /** @default true */
    hover?: boolean;
    /** @default true */
    signatureHelp?: boolean;
    /** @default true */
    formatting?: boolean;
    /** @default true */
    monarchTokenizer?: boolean;
    /** @default 300 */
    diagnosticDelay?: number;
}

export interface MonacoDiagnosticsProviderOptions {
    /** @default "cosmosdb-sql" */
    languageId?: string;
    /** @default "cosmosdb-sql" */
    owner?: string;
    /** @default 300 */
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

