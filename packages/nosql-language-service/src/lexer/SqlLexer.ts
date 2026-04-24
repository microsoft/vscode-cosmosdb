/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module lexer/SqlLexer
 *
 * Singleton Chevrotain {@link Lexer} for CosmosDB NoSQL SQL.
 * Tokenizes a query string into a flat token array with full
 * position tracking (line, column, offset) on every token.
 *
 * @internal — consumers should use {@link parse} from the main entry point.
 */

import { Lexer } from 'chevrotain';
import { allTokens } from './tokens.js';

/**
 * Pre-built lexer instance. Chevrotain lexers are stateless and safe
 * to share across calls — no need to re-create per parse.
 */
export const SqlLexer = new Lexer(allTokens, {
    ensureOptimizations: true,
    // positionTracking is "full" by default — gives line/col on every token
});
