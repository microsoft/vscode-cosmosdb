/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public API surface for the NoSQL AST tokenizer and parser.
 *
 * Consumers should import from this barrel module:
 *
 * ```ts
 * import { getCursorContext, tokenize, type CursorContext, type Token } from './AST';
 * ```
 */

export { getCursorContext } from './parser';
export { tokenize } from './tokenizer';
export type { CursorContext, JoinAlias, SubPosition, Token, TokenType } from './types';
