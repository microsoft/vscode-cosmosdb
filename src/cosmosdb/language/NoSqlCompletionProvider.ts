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
import { getCursorContext } from './AST';
import { NOSQL_FUNCTIONS, NOSQL_KEYWORDS, NOSQL_LANGUAGE_ID, type KeywordCategory } from './nosqlLanguageDefinitions';
import { computeAliasSortKey, computeFunctionSortKey, computeKeywordSortKey } from './nosqlParser';

/**
 * VS Code command descriptor that re-triggers the suggest widget after a completion is accepted.
 * Attached to keywords/aliases whose insertText ends with a space so the user immediately
 * sees the next set of relevant suggestions (e.g. SELECT → TOP / DISTINCT / alias).
 */
const RETRIGGER_SUGGEST_COMMAND: vscode.Command = {
    command: 'editor.action.triggerSuggest',
    title: 'Re-trigger completions',
};

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

        // ── 0. Semicolon auto-formatting: insert ;\n\n ─────────────────
        if (textBeforeCursor.endsWith(';')) {
            const item = new vscode.CompletionItem(';', vscode.CompletionItemKind.Snippet);
            item.insertText = new vscode.SnippetString(';\n\n$0');
            item.range = new vscode.Range(position.translate(0, -1), position);
            item.detail = 'End query and start a new one';
            item.sortText = '0';
            item.preselect = true;
            return [item];
        }

        // If dot-triggered (e.g. `c.`), don't provide keyword/function suggestions.
        // Schema-driven property suggestions would require an active connection
        // which standalone .nosql files don't have.
        const dotMatch = textBeforeCursor.match(/(\w+(?:\.\w+)*)\.(\w*)$/);
        if (dotMatch) {
            return [];
        }

        const suggestions: vscode.CompletionItem[] = [];

        // Parse query context — single entry point via AST parser
        const textUntilPosition = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const cursorOffset = textUntilPosition.length;
        const fullText = document.getText();
        const cursorCtx = getCursorContext(fullText, cursorOffset);
        const { fromAlias, joinAliases } = cursorCtx;

        // ── After LIKE keyword: suggest string literal templates ────────
        if (/\bLIKE\s+$/i.test(textBeforeCursor)) {
            const doubleQuoteItem = new vscode.CompletionItem('"..."', vscode.CompletionItemKind.Value);
            doubleQuoteItem.insertText = new vscode.SnippetString('"$0"');
            doubleQuoteItem.detail = 'String literal (double quotes)';
            doubleQuoteItem.sortText = '0';
            suggestions.push(doubleQuoteItem);

            const singleQuoteItem = new vscode.CompletionItem("'...'", vscode.CompletionItemKind.Value);
            singleQuoteItem.insertText = new vscode.SnippetString("'$0'");
            singleQuoteItem.detail = 'String literal (single quotes)';
            singleQuoteItem.sortText = '1';
            suggestions.push(singleQuoteItem);
            return suggestions;
        }

        // Clause context from AST parser (already computed above)
        const clauseCtx = cursorCtx;

        // ── Special context suggestions ────────────────────────────────

        // After IN operator: suggest `(` for value list
        if (clauseCtx.precedingToken === 'in' && clauseCtx.clause === 'where') {
            const parenItem = new vscode.CompletionItem('(...)', vscode.CompletionItemKind.Snippet);
            parenItem.insertText = new vscode.SnippetString('($0)');
            parenItem.detail = 'Value list';
            parenItem.sortText = '0';
            suggestions.push(parenItem);
        }

        // After SELECT (initial): suggest `*`
        if (clauseCtx.clause === 'select' && clauseCtx.subPosition === 'initial') {
            const starItem = new vscode.CompletionItem('*', vscode.CompletionItemKind.Keyword);
            starItem.insertText = '* ';
            starItem.detail = 'Select all fields';
            starItem.sortText = '00_*';
            starItem.command = RETRIGGER_SUGGEST_COMMAND;
            suggestions.push(starItem);
        }

        // ── 1. Keyword completions ─────────────────────────────────────
        for (const keyword of NOSQL_KEYWORDS) {
            const item = new vscode.CompletionItem(keyword.name, categoryToCompletionKind(keyword.category));
            item.insertText = keyword.snippet;
            item.detail = keyword.signature;
            item.documentation = new vscode.MarkdownString(
                `${keyword.description}\n\n[Documentation](${keyword.link})`,
            );

            let sortText = computeKeywordSortKey(keyword, clauseCtx);

            // Special sub-position boosts
            if (keyword.name === 'ASC' || keyword.name === 'DESC') {
                if (clauseCtx.clause === 'orderby' && clauseCtx.subPosition === 'post-expression') {
                    sortText = `00_${keyword.name}`;
                }
            }
            if (keyword.name === 'TOP' || keyword.name === 'DISTINCT' || keyword.name === 'VALUE') {
                if (clauseCtx.clause === 'select' && clauseCtx.subPosition === 'initial') {
                    sortText = `01_${keyword.name}`;
                }
            }

            item.sortText = sortText;

            // Re-trigger suggest after keywords that end with a space
            if (keyword.snippet.endsWith(' ')) {
                item.command = RETRIGGER_SUGGEST_COMMAND;
            }

            suggestions.push(item);
        }

        // ── 2. Function completions ────────────────────────────────────
        for (const func of NOSQL_FUNCTIONS) {
            const item = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
            item.insertText = new vscode.SnippetString(func.snippet);
            item.detail = func.signature;
            item.documentation = new vscode.MarkdownString(`${func.description}\n\n[Documentation](${func.link})`);
            item.sortText = computeFunctionSortKey(func.name, clauseCtx);
            suggestions.push(item);
        }

        // ── 3. Alias suggestions (FROM + JOIN aliases) ──────────────────
        const aliasItem = new vscode.CompletionItem(fromAlias, vscode.CompletionItemKind.Variable);
        aliasItem.detail = 'Collection alias from FROM clause';
        aliasItem.sortText = computeAliasSortKey(fromAlias, clauseCtx);
        suggestions.push(aliasItem);

        for (const joinAlias of joinAliases) {
            const joinAliasItem = new vscode.CompletionItem(joinAlias.alias, vscode.CompletionItemKind.Variable);
            joinAliasItem.detail = `JOIN ${joinAlias.alias} IN ${joinAlias.sourceAlias}.${joinAlias.propertyPath.join('.')}`;
            joinAliasItem.sortText = computeAliasSortKey(joinAlias.alias, clauseCtx);
            suggestions.push(joinAliasItem);
        }

        return suggestions;
    }
}

/**
 * Registers the NoSQL completion provider with VS Code.
 * Returns a disposable that should be added to `context.subscriptions`.
 */
export function registerNoSqlVSCodeCompletionProvider(): vscode.Disposable {
    return vscode.languages.registerCompletionItemProvider(
        NOSQL_LANGUAGE_ID,
        new NoSqlCompletionProvider(),
        '.',
        ' ',
        ';',
    );
}
