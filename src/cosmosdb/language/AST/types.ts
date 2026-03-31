/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared type definitions for the NoSQL AST tokenizer and parser.
 *
 * This module is environment-agnostic — it imports neither `vscode` nor `monaco-editor`.
 */

import { type ClauseType } from '../nosqlLanguageDefinitions';

// ─── Token types ────────────────────────────────────────────────────────────────

/** Discriminated token types produced by the tokenizer. */
export type TokenType =
    | 'keyword'
    | 'function'
    | 'identifier'
    | 'operator'
    | 'string'
    | 'number'
    | 'comment'
    | 'punctuation';

/** A single token produced by the tokenizer. */
export interface Token {
    /** Semantic type of the token. */
    type: TokenType;
    /** Original text from the source query. */
    value: string;
    /** Zero-based start offset in the source text (inclusive). */
    start: number;
    /** Zero-based end offset in the source text (exclusive). */
    end: number;
}

// ─── CursorContext ──────────────────────────────────────────────────────────────

/** Represents a JOIN alias and the schema path it references. */
export interface JoinAlias {
    alias: string;
    sourceAlias: string;
    propertyPath: string[];
}

/**
 * Sub-positions within a clause that affect what completions are valid.
 * - `initial` — directly after the clause keyword, nothing typed yet
 * - `post-expression` — after a value/expression (e.g. after `ORDER BY c.name`)
 * - `post-star` — after `SELECT *`
 * - `post-alias` — after `FROM c` (where next clauses like JOIN/WHERE are valid)
 */
export type SubPosition = 'initial' | 'post-expression' | 'post-star' | 'post-alias';

/**
 * Complete cursor context produced by a single `getCursorContext` call.
 *
 * Replaces the combination of `getCurrentQueryBlock`, `detectClauseContext`,
 * `detectFunctionArgContext`, `extractFromAlias`, and `extractJoinAliases`.
 */
export interface CursorContext {
    /** The text of the query block that contains the cursor. */
    queryBlockText: string;

    /** Which clause the cursor is currently inside. */
    clause: ClauseType;

    /** Fine-grained position within the clause. */
    subPosition: SubPosition;

    /** The FROM alias in the current query block (defaults to `"c"`). */
    fromAlias: string;

    /** All JOIN aliases in the current query block. */
    joinAliases: JoinAlias[];

    /** Non-null when the cursor is inside a function call's arguments. */
    insideFunction: { name: string; argIndex: number } | null;

    /** Current parenthesis nesting depth at the cursor position. */
    insideParenDepth: number;

    /** The preceding non-whitespace token before the cursor (lowercase), if any. */
    precedingToken: string | null;

    /** Whether the query contains a GROUP BY clause. */
    hasGroupBy: boolean;
}
