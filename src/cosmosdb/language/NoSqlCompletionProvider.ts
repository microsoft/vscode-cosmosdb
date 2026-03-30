/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VS Code CompletionItemProvider for CosmosDB NoSQL query language.
 *
 * Provides context-aware autocompletion in the VS Code text editor for `.nosql` files:
 * - SQL keywords (SELECT, FROM, WHERE, ORDER BY, etc.)
 * - Built-in functions with signatures (aggregate, string, math, type-checking, etc.)
 * - Collection alias from the FROM clause
 *
 * Note: Schema-driven property suggestions are NOT available for standalone `.nosql` files
 * since there is no implicit database/container connection. Schema-based completion is
 * only available in the webview-based Query Editor which has an active connection.
 */

import * as vscode from 'vscode';
import { NOSQL_FUNCTIONS, NOSQL_KEYWORDS, NOSQL_LANGUAGE_ID, type KeywordCategory } from './nosqlLanguageDefinitions';
import { extractFromAlias } from './nosqlParser';

/**
 * Maps a keyword category to the appropriate VS Code CompletionItemKind.
 */
function categoryToCompletionKind(category: KeywordCategory): vscode.CompletionItemKind {
    switch (category) {
        case 'clause':
            return vscode.CompletionItemKind.Keyword;
        case 'operator':
            return vscode.CompletionItemKind.Operator;
        case 'constant':
            return vscode.CompletionItemKind.Constant;
        case 'keyword':
        default:
            return vscode.CompletionItemKind.Keyword;
    }
}

export class NoSqlCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext,
    ): vscode.CompletionItem[] {
        const lineText = document.lineAt(position).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // If dot-triggered (e.g. `c.`), don't provide keyword/function suggestions.
        // Schema-driven property suggestions would require an active connection
        // which standalone .nosql files don't have.
        const dotMatch = textBeforeCursor.match(/(\w+(?:\.\w+)*)\.(\w*)$/);
        if (dotMatch) {
            return [];
        }

        const textUntilPosition = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

        const suggestions: vscode.CompletionItem[] = [];

        // ── 1. Keyword completions ─────────────────────────────────────
        for (const keyword of NOSQL_KEYWORDS) {
            const item = new vscode.CompletionItem(keyword.name, categoryToCompletionKind(keyword.category));
            item.insertText = keyword.snippet;
            item.detail = keyword.signature;
            item.documentation = new vscode.MarkdownString(
                `${keyword.description}\n\n[Documentation](${keyword.link})`,
            );
            item.sortText = `1_${keyword.name}`;
            suggestions.push(item);
        }

        // ── 2. Function completions ────────────────────────────────────
        for (const func of NOSQL_FUNCTIONS) {
            const item = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
            item.insertText = new vscode.SnippetString(func.snippet);
            item.detail = func.signature;
            item.documentation = new vscode.MarkdownString(`${func.description}\n\n[Documentation](${func.link})`);
            item.sortText = `2_${func.name}`;
            suggestions.push(item);
        }

        // ── 3. Alias suggestion ────────────────────────────────────────
        const fromAlias = extractFromAlias(textUntilPosition);
        const aliasItem = new vscode.CompletionItem(fromAlias, vscode.CompletionItemKind.Variable);
        aliasItem.detail = 'Collection alias from FROM clause';
        aliasItem.sortText = `0_${fromAlias}`;
        suggestions.push(aliasItem);

        return suggestions;
    }
}

/**
 * Registers the NoSQL completion provider with VS Code.
 * Returns a disposable that should be added to `context.subscriptions`.
 */
export function registerNoSqlVSCodeCompletionProvider(): vscode.Disposable {
    return vscode.languages.registerCompletionItemProvider(NOSQL_LANGUAGE_ID, new NoSqlCompletionProvider(), '.', ' ');
}
