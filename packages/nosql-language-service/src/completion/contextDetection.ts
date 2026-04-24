/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Context detection for CosmosDB NoSQL SQL autocomplete
//
// Analyses the cursor position within a query and determines what kind of
// completions should be offered.
// ---------------------------------------------------------------------------

import { type IToken, type TokenType } from 'chevrotain';
import { SqlLexer } from '../lexer/SqlLexer.js';
import * as T from '../lexer/tokens.js';

// ========================== Context enum =====================================

export enum CompletionContext {
    /** Start of query or after semicolon */
    QueryStart,
    /** Right after SELECT keyword */
    AfterSelect,
    /** After SELECT projection is complete (e.g. "SELECT *", "SELECT c.id") — expects FROM, WHERE, etc. */
    AfterSelectSpec,
    /** Inside SELECT list (after first item) */
    InSelectList,
    /** Right after FROM keyword */
    AfterFrom,
    /** After FROM alias, expecting clause keyword */
    AfterFromClause,
    /** Right after WHERE keyword */
    AfterWhere,
    /** Inside WHERE expression */
    InWhereExpression,
    /** After a dot (property access) */
    AfterDot,
    /** After ORDER keyword */
    AfterOrder,
    /** After GROUP keyword */
    AfterGroup,
    /** After ORDER BY / GROUP BY */
    AfterOrderBy,
    /** General expression position */
    InExpression,
    /** Inside function call parens */
    InFunctionArgs,
    /** Unknown / fallback */
    Unknown,
}

// ========================== Cursor context ===================================

export interface CursorContext {
    context: CompletionContext;
    /** The token immediately before the cursor */
    prevToken?: IToken;
    /** The prefix the user is typing (for filtering), e.g. "c.na" → dotPrefix="c", fieldPrefix="na" */
    dotPrefix?: string;
    /** Partial text being typed */
    typingPrefix: string;
    /** Detected aliases from `FROM` clause */
    aliases: string[];
}

// ========================== Used SELECT modifiers ============================

export interface UsedSelectModifiers {
    hasDistinct: boolean;
    hasTop: boolean;
    hasValue: boolean;
}

// ========================== Main detection ====================================

export function detectContext(query: string, offset: number): CursorContext {
    const lexResult = SqlLexer.tokenize(query);
    const tokens = lexResult.tokens;

    // Find the text being typed at cursor position
    let typingPrefix = '';
    const textBeforeCursor = query.substring(0, offset);
    const trailingMatch = textBeforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
    if (trailingMatch) {
        typingPrefix = trailingMatch[0];
    }

    // Find which token the cursor is in or right after
    let tokenBeforeCursor: IToken | undefined;
    let tokenBeforePrev: IToken | undefined;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startOffset >= offset) break;
        tokenBeforePrev = tokenBeforeCursor;
        tokenBeforeCursor = t;
    }

    // Detect aliases from `FROM` clause
    const aliases = detectAliases(tokens);

    // Check for dot context: "c." or "c.na"
    const dotMatch = textBeforeCursor.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)?$/);
    if (dotMatch) {
        return {
            context: CompletionContext.AfterDot,
            prevToken: tokenBeforeCursor,
            dotPrefix: dotMatch[1],
            typingPrefix: dotMatch[2] ?? '',
            aliases,
        };
    }

    if (!tokenBeforeCursor) {
        return { context: CompletionContext.QueryStart, typingPrefix, aliases };
    }

    const prevType = tokenBeforeCursor.tokenType;

    // Determine context from the previous token
    if (prevType === T.Select) {
        return { context: CompletionContext.AfterSelect, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.From) {
        return { context: CompletionContext.AfterFrom, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Where) {
        return { context: CompletionContext.AfterWhere, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Order) {
        return { context: CompletionContext.AfterOrder, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Group) {
        return { context: CompletionContext.AfterGroup, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.By) {
        return { context: CompletionContext.AfterOrderBy, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Comma) {
        // Figure out what clause we're in by scanning backwards
        const clause = findEnclosingClause(tokens, tokenBeforeCursor);
        if (clause === 'SELECT')
            return { context: CompletionContext.InSelectList, prevToken: tokenBeforeCursor, typingPrefix, aliases };
        if (clause === 'ORDER BY')
            return { context: CompletionContext.AfterOrderBy, prevToken: tokenBeforeCursor, typingPrefix, aliases };
        return { context: CompletionContext.InExpression, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Dot) {
        return { context: CompletionContext.AfterDot, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }

    // "SELECT * |" — Star after SELECT means spec is complete
    if (prevType === T.Star && hasSelectBefore(tokens, tokenBeforeCursor)) {
        return { context: CompletionContext.AfterSelectSpec, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }

    // After clause-ending tokens (identifier after FROM, etc.) — suggest next clause
    if (isIdentifierLike(prevType)) {
        // If user is mid-typing right after SELECT → still AfterSelect context
        // e.g. "SELECT T|" should suggest TOP, not just expression items
        if (tokenBeforePrev?.tokenType === T.Select) {
            return { context: CompletionContext.AfterSelect, prevToken: tokenBeforePrev, typingPrefix, aliases };
        }
        // After SELECT spec (e.g. "SELECT * FORM|", "SELECT c.id FR|")
        // — suggest clause keywords like FROM, WHERE, etc.
        if (hasSelectBefore(tokens, tokenBeforeCursor)) {
            return { context: CompletionContext.AfterSelectSpec, prevToken: tokenBeforeCursor, typingPrefix, aliases };
        }
        // Check if we're right after FROM alias
        if (tokenBeforePrev?.tokenType === T.From || tokenBeforePrev?.tokenType === T.As) {
            return { context: CompletionContext.AfterFromClause, prevToken: tokenBeforeCursor, typingPrefix, aliases };
        }
        // Check if preceding context is a comparison/operator → expression
        return { context: CompletionContext.InExpression, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (isOperator(prevType)) {
        return { context: CompletionContext.InExpression, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.LParen) {
        return { context: CompletionContext.InFunctionArgs, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }

    // After SELECT modifiers — user still needs to type projection
    // "SELECT TOP 10 |" → need *, VALUE, aliases, functions (but not TOP again)
    // "SELECT DISTINCT |" → need *, VALUE, TOP, aliases, functions (but not DISTINCT again)
    // "SELECT VALUE |" → need expression (aliases, functions)
    if (isNumberLiteral(prevType) && tokenBeforePrev?.tokenType === T.Top) {
        return { context: CompletionContext.AfterSelect, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Distinct) {
        return { context: CompletionContext.AfterSelect, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Value) {
        return { context: CompletionContext.AfterSelect, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    // After parameter in TOP position: "SELECT TOP @limit |"
    if (prevType === T.Parameter && tokenBeforePrev?.tokenType === T.Top) {
        return { context: CompletionContext.AfterSelect, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }

    return { context: CompletionContext.Unknown, prevToken: tokenBeforeCursor, typingPrefix, aliases };
}

// ========================== SELECT modifier detection =========================

/**
 * Scan tokens between SELECT and cursor to find which modifiers are already present.
 * sql.y grammar: SELECT [DISTINCT] [TOP N] selection
 */
export function detectUsedSelectModifiers(query: string, offset: number): UsedSelectModifiers {
    const lexResult = SqlLexer.tokenize(query);
    const tokens = lexResult.tokens;
    const result: UsedSelectModifiers = { hasDistinct: false, hasTop: false, hasValue: false };

    // Find the last SELECT before cursor, then scan forward
    let selectIdx = -1;
    for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].startOffset < offset && tokens[i].tokenType === T.Select) {
            selectIdx = i;
            break;
        }
    }
    if (selectIdx < 0) return result;

    for (let i = selectIdx + 1; i < tokens.length && tokens[i].startOffset < offset; i++) {
        const tt = tokens[i].tokenType;
        if (tt === T.Distinct) result.hasDistinct = true;
        if (tt === T.Top) result.hasTop = true;
        if (tt === T.Value) result.hasValue = true;
        // Stop at clause boundaries
        if (tt === T.From || tt === T.Where || tt === T.Order || tt === T.Group) break;
    }
    return result;
}

// ========================== Helper functions ==================================

function detectAliases(tokens: IToken[]): string[] {
    const aliases: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].tokenType === T.From && i + 1 < tokens.length && isIdentifierLike(tokens[i + 1].tokenType)) {
            const collection = tokens[i + 1].image;
            // Check for AS alias
            if (i + 2 < tokens.length && tokens[i + 2].tokenType === T.As && i + 3 < tokens.length) {
                aliases.push(tokens[i + 3].image);
            } else if (
                i + 2 < tokens.length &&
                isIdentifierLike(tokens[i + 2].tokenType) &&
                !isClauseKeyword(tokens[i + 2].tokenType)
            ) {
                aliases.push(tokens[i + 2].image);
            } else {
                aliases.push(collection);
            }
        }
        // Iterator: x IN collection
        if (tokens[i].tokenType === T.In && i - 1 >= 0 && isIdentifierLike(tokens[i - 1].tokenType)) {
            aliases.push(tokens[i - 1].image);
        }
    }
    return [...new Set(aliases)];
}

function findEnclosingClause(tokens: IToken[], comma: IToken): string {
    for (let i = tokens.indexOf(comma); i >= 0; i--) {
        if (tokens[i].tokenType === T.Select) return 'SELECT';
        if (tokens[i].tokenType === T.By) return 'ORDER BY';
        if (tokens[i].tokenType === T.Where) return 'WHERE';
    }
    return 'UNKNOWN';
}

export function isIdentifierLike(type: TokenType): boolean {
    return type === T.Identifier || type === T.Let || type === T.Rank || type === T.Left || type === T.Right;
}

function isClauseKeyword(type: TokenType): boolean {
    return (
        type === T.Where ||
        type === T.Order ||
        type === T.Group ||
        type === T.Join ||
        type === T.Offset ||
        type === T.Limit
    );
}

function isOperator(type: TokenType): boolean {
    return (
        type === T.Equals ||
        type === T.NotEqual ||
        type === T.LessThan ||
        type === T.GreaterThan ||
        type === T.LessThanEqual ||
        type === T.GreaterThanEqual ||
        type === T.Plus ||
        type === T.Minus ||
        type === T.Star ||
        type === T.Slash ||
        type === T.And ||
        type === T.Or
    );
}

function isNumberLiteral(type: TokenType): boolean {
    return type === T.NumberLiteral || type === T.IntegerLiteral || type === T.DoubleLiteral;
}

/**
 * Scan backwards from a token to check if there's a SELECT before it
 * without any intervening clause keyword (FROM, WHERE, etc.).
 * Used to detect "after SELECT spec" positions like "SELECT * |" or "SELECT c.id |".
 */
function hasSelectBefore(tokens: IToken[], fromToken: IToken): boolean {
    const idx = tokens.indexOf(fromToken);
    for (let i = idx - 1; i >= 0; i--) {
        const tt = tokens[i].tokenType;
        if (tt === T.Select) return true;
        // Stop if we hit another clause — we're past the SELECT spec
        if (
            tt === T.From ||
            tt === T.Where ||
            tt === T.Order ||
            tt === T.Group ||
            tt === T.Join ||
            tt === T.Offset ||
            tt === T.Limit
        ) {
            return false;
        }
    }
    return false;
}

