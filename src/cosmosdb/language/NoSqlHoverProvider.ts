/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VS Code HoverProvider for CosmosDB NoSQL query language.
 *
 * Shows inline documentation for keywords and built-in functions
 * when the cursor hovers over them in `.nosql` files.
 */

import * as vscode from 'vscode';
import { getNoSqlHoverContent } from './nosqlHover';
import { NOSQL_LANGUAGE_ID } from './nosqlLanguageDefinitions';

export class NoSqlHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): vscode.Hover | null {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        const content = getNoSqlHoverContent(word);
        if (!content) {
            return null;
        }

        const markdown = new vscode.MarkdownString(content.markdown, true);
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        return new vscode.Hover(markdown, wordRange);
    }
}

/**
 * Registers the NoSQL hover provider with VS Code.
 * Returns a disposable that should be added to `context.subscriptions`.
 */
export function registerNoSqlVSCodeHoverProvider(): vscode.Disposable {
    return vscode.languages.registerHoverProvider(NOSQL_LANGUAGE_ID, new NoSqlHoverProvider());
}
