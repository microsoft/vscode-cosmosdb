/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SqlLanguageService } from '../../services/index.js';
import { type Disposable } from '../../services/types.js';
import { LANGUAGE_ID } from '../shared.js';
import { MonacoCompletionProvider } from './completionProvider.js';
import { MonacoDiagnosticsProvider } from './diagnosticsProvider.js';
import { MonacoFoldingRangeProvider } from './foldingRangeProvider.js';
import { MonacoFormattingProvider } from './formattingProvider.js';
import { MonacoHoverProvider } from './hoverProvider.js';
import { cosmosDbSqlLanguageConfiguration, cosmosDbSqlMonarchTokensProvider } from './monarchTokenizer.js';
import { MonacoMultiQueryDecorator } from './multiQueryDecorator.js';
import { MonacoSignatureHelpProvider } from './signatureHelpProvider.js';
import { type MonacoNamespace, type MonacoRegistrationOptions } from './types.js';

/**
 * Register CosmosDB NoSQL SQL language support in a Monaco editor
 * instance. Returns a {@link Disposable} that unregisters everything.
 */
export function registerCosmosDbSql(
    monaco: MonacoNamespace,
    service: SqlLanguageService,
    options: MonacoRegistrationOptions = {},
): Disposable {
    const langId = options.languageId ?? LANGUAGE_ID;
    const disposables: Disposable[] = [];

    // Register language (if not already registered)
    const languages = monaco.languages.getLanguages();
    if (!languages.some((l) => l.id === langId)) {
        monaco.languages.register({
            id: langId,
            extensions: ['.nosql'],
            aliases: ['CosmosDB NoSQL', langId],
        });
    }

    if (options.monarchTokenizer !== false) {
        monaco.languages.setLanguageConfiguration(langId, cosmosDbSqlLanguageConfiguration);
        monaco.languages.setMonarchTokensProvider(langId, cosmosDbSqlMonarchTokensProvider);
    }

    if (options.completions !== false) {
        disposables.push(
            monaco.languages.registerCompletionItemProvider(langId, new MonacoCompletionProvider(monaco, service)),
        );
    }

    if (options.diagnostics !== false) {
        disposables.push(
            new MonacoDiagnosticsProvider(monaco, service, {
                languageId: langId,
                owner: 'cosmosdb-sql',
                diagnosticDelay: options.diagnosticDelay,
            }),
        );
    }

    if (options.hover !== false) {
        disposables.push(monaco.languages.registerHoverProvider(langId, new MonacoHoverProvider(monaco, service)));
    }

    if (options.signatureHelp !== false) {
        disposables.push(
            monaco.languages.registerSignatureHelpProvider(langId, new MonacoSignatureHelpProvider(service)),
        );
    }

    if (options.formatting !== false) {
        disposables.push(
            monaco.languages.registerDocumentFormattingEditProvider(langId, new MonacoFormattingProvider(service)),
        );
    }

    disposables.push(monaco.languages.registerFoldingRangeProvider(langId, new MonacoFoldingRangeProvider(service)));
    disposables.push(
        new MonacoMultiQueryDecorator(monaco, service, {
            languageId: langId,
            decorationDelay: options.diagnosticDelay,
        }),
    );

    return {
        dispose() {
            for (const d of disposables) d.dispose();
            disposables.length = 0;
        },
    };
}

