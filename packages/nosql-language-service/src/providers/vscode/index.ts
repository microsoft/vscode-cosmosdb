/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { LANGUAGE_ID } from '../shared.js';
export { VSCodeCompletionProvider } from './completionProvider.js';
export { VSCodeDiagnosticsProvider } from './diagnosticsProvider.js';
export { VSCodeFoldingRangeProvider } from './foldingRangeProvider.js';
export { VSCodeFormattingProvider } from './formattingProvider.js';
export { VSCodeHoverProvider } from './hoverProvider.js';
export { VSCodeMultiQueryDecorator } from './multiQueryDecorator.js';
export { registerCosmosDbSql } from './register.js';
export { VSCodeSignatureHelpProvider } from './signatureHelpProvider.js';
export type { VSCodeDiagnosticsProviderOptions, VSCodeNamespace, VSCodeRegistrationOptions } from './types.js';

