/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Barrel re-export for @cosmosdb/nosql-language-service/monaco

export { LANGUAGE_ID } from '../shared.js';
export { MonacoCompletionProvider } from './completionProvider.js';
export { MonacoDiagnosticsProvider } from './diagnosticsProvider.js';
export { MonacoFoldingRangeProvider } from './foldingRangeProvider.js';
export { MonacoFormattingProvider } from './formattingProvider.js';
export { MonacoHoverProvider } from './hoverProvider.js';
export { cosmosDbSqlLanguageConfiguration, cosmosDbSqlMonarchTokensProvider } from './monarchTokenizer.js';
export { MonacoMultiQueryDecorator } from './multiQueryDecorator.js';
export { registerCosmosDbSql } from './register.js';
export { MonacoSignatureHelpProvider } from './signatureHelpProvider.js';
export type { MonacoDiagnosticsProviderOptions, MonacoNamespace, MonacoRegistrationOptions } from './types.js';

