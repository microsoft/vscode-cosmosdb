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
    /** @default 300 */
    diagnosticDelay?: number;
    /** @default 300 */
    decorationDelay?: number;
}

export interface VSCodeDiagnosticsProviderOptions {
    /** @default "cosmosdb-sql" */
    languageId?: string;
    /** @default "cosmosdb-sql" */
    collectionName?: string;
    /** @default 300 */
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

