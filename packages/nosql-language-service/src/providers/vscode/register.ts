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

    if (typeof vscode.languages.registerFoldingRangeProvider === 'function') {
        disposables.push(
            vscode.languages.registerFoldingRangeProvider(selector, new VSCodeFoldingRangeProvider(vscode, service)),
        );
    }

    disposables.push(
        new VSCodeMultiQueryDecorator(vscode, service, {
            languageId: langId,
            decorationDelay: options.decorationDelay ?? options.diagnosticDelay,
        }),
    );

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

