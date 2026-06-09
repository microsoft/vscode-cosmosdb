/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SqlLanguageService } from '../../services/index.js';
import { type Disposable } from '../../services/types.js';
import { LANGUAGE_ID } from '../shared.js';
import { VSCodeCompletionProvider } from './completionProvider.js';
import { VSCodeDiagnosticsProvider } from './diagnosticsProvider.js';
import { VSCodeFoldingRangeProvider } from './foldingRangeProvider.js';
import { VSCodeFormattingProvider } from './formattingProvider.js';
import { VSCodeHoverProvider } from './hoverProvider.js';
import { VSCodeMultiQueryDecorator } from './multiQueryDecorator.js';
import { VSCodeSignatureHelpProvider } from './signatureHelpProvider.js';
import { type VSCodeNamespace, type VSCodeRegistrationOptions } from './types.js';

export function registerCosmosDbSql(
    vscode: VSCodeNamespace,
    service: SqlLanguageService,
    context?: { subscriptions: Disposable[] },
    options: VSCodeRegistrationOptions = {},
): Disposable {
    const langId = options.languageId ?? LANGUAGE_ID;
    const selector = { language: langId, scheme: '*' };
    const disposables: Disposable[] = [];

    if (options.completions !== false) {
        // Trigger characters mirror the Monaco completion provider's set:
        // `.` (member access), ` ` (after keyword), `,` (next column/arg),
        // and `\n` (start of a new query in multi-query documents — users
        // see `SELECT` proposed without needing Ctrl+Space).
        // `;` is intentionally NOT a trigger: re-opening the suggest widget
        // while still finishing the current statement is distracting; the
        // widget will open on the subsequent newline anyway.
        disposables.push(
            vscode.languages.registerCompletionItemProvider(
                selector,
                new VSCodeCompletionProvider(vscode, service),
                '.',
                ' ',
                ',',
                '\n',
            ),
        );
    }

    if (options.diagnostics !== false) {
        disposables.push(
            new VSCodeDiagnosticsProvider(vscode, service, {
                languageId: langId,
                collectionName: 'cosmosdb-sql',
                diagnosticDelay: options.diagnosticDelay,
            }),
        );
    }

    if (options.hover !== false) {
        disposables.push(vscode.languages.registerHoverProvider(selector, new VSCodeHoverProvider(vscode, service)));
    }

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

    if (options.formatting !== false) {
        disposables.push(
            vscode.languages.registerDocumentFormattingEditProvider(
                selector,
                new VSCodeFormattingProvider(vscode, service),
            ),
        );
    }

    const multiQuery = service.multiQuery;

    if ((options.folding ?? multiQuery) && typeof vscode.languages.registerFoldingRangeProvider === 'function') {
        disposables.push(
            vscode.languages.registerFoldingRangeProvider(selector, new VSCodeFoldingRangeProvider(vscode, service)),
        );
    }

    if (options.multiQueryDecorations ?? multiQuery) {
        disposables.push(
            new VSCodeMultiQueryDecorator(vscode, service, {
                languageId: langId,
                decorationDelay: options.decorationDelay ?? options.diagnosticDelay,
                highlightActiveBlock: options.highlightActiveBlock,
            }),
        );
    }

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
