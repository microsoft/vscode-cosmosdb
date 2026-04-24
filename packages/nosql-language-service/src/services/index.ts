/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// @cosmosdb/nosql-language-service/services — re-exports
// ---------------------------------------------------------------------------

export { FUNCTION_SIGNATURES, getFunctionMeta } from './functionSignatures.js';
export type { FunctionMeta } from './functionSignatures.js';
export { parseMultiQueryDocument } from './MultiQueryDocument.js';
export type { MultiQueryDocument, QueryRegion } from './MultiQueryDocument.js';
export { SqlLanguageService } from './SqlLanguageService.js';
export * from './types.js';
