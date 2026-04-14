/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lightweight clause-level parser for CosmosDB NoSQL queries.
 *
 * Walks the token stream produced by `tokenize()` to build a single
 * {@link CursorContext} object that captures clause position, aliases,
 * function-argument context, and other information needed by the
 * completion providers.
 *
 * Replaces the regex-based functions: `getCurrentQueryBlock`,
 * `detectClauseContext`, `detectFunctionArgContext`, `extractFromAlias`,
 * and `extractJoinAliases`.
 *
 * Environment-agnostic — no `vscode` or `monaco-editor` imports.
 */

import { type ClauseType } from '../nosqlLanguageDefinitions';
import { tokenize } from './tokenizer';
import { type CursorContext, type JoinAlias, type SubPosition, type Token } from './types';

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Single entry point that analyses a full editor text and a cursor offset
 * and returns a rich {@link CursorContext} describing everything the
 * completion providers need to know.
 *
 * @param fullText     - The entire editor content.
 * @param cursorOffset - Zero-based character offset of the cursor within `fullText`.
 * @returns A fully-populated {@link CursorContext}.
 */
export function getCursorContext(fullText: string, cursorOffset: number): CursorContext {
    // 1. Split into query blocks and find the one containing the cursor
    const { blockText, blockStart } = findCursorBlock(fullText, cursorOffset);

    // 2. Tokenize just the current query block
    const allTokens = tokenize(blockText);

    // Filter out comments for the semantic analysis
    const tokens = allTokens.filter((t) => t.type !== 'comment');

    // Cursor offset relative to the block start
    const cursorInBlock = cursorOffset - blockStart;

    // 3. Extract FROM alias
    const fromAlias = parseFromAlias(tokens);

    // 4. Extract JOIN aliases
    const joinAliases = parseJoinAliases(tokens);

    // 5. Detect GROUP BY anywhere in the block
    const hasGroupBy = tokens.some((t) => t.type === 'keyword' && t.value.toUpperCase() === 'GROUP BY');

    // 6. Walk tokens up to the cursor to detect clause context
    const tokensBeforeCursor = tokens.filter((t) => t.end <= cursorInBlock);

    const { clause, subPosition, insideFunction, insideParenDepth, precedingToken } = analyzeTokensBeforeCursor(
        tokensBeforeCursor,
        cursorInBlock,
    );

    return {
        queryBlockText: blockText,
        clause,
        subPosition,
        fromAlias,
        joinAliases,
        insideFunction,
        insideParenDepth,
        precedingToken,
        hasGroupBy,
    };
}

// ─── Query block splitting ──────────────────────────────────────────────────────

interface BlockInfo {
    blockText: string;
    blockStart: number;
}

/**
 * Splits the full text on top-level semicolons (those not inside strings or comments)
 * and returns the block text + start offset for the block containing the cursor.
 */
function findCursorBlock(fullText: string, cursorOffset: number): BlockInfo {
    // Tokenize the full text just to find semicolon boundaries
    const tokens = tokenize(fullText);
    const boundaries: number[] = [];

    for (const tok of tokens) {
        if (tok.type === 'punctuation' && tok.value === ';') {
            boundaries.push(tok.start);
        }
    }

    let blockStart = 0;
    for (const b of boundaries) {
        if (b >= cursorOffset) break;
        blockStart = b + 1;
    }

    let blockEnd = fullText.length;
    for (const b of boundaries) {
        if (b >= cursorOffset) {
            blockEnd = b;
            break;
        }
    }

    return {
        blockText: fullText.substring(blockStart, blockEnd),
        blockStart,
    };
}

// ─── FROM alias extraction ──────────────────────────────────────────────────────

const KEYWORD_UPPER_SET: ReadonlySet<string> = new Set([
    'SELECT',
    'FROM',
    'WHERE',
    'ORDER BY',
    'GROUP BY',
    'JOIN',
    'OFFSET',
    'LIMIT',
    'AND',
    'OR',
    'NOT',
    'IN',
    'BETWEEN',
    'LIKE',
    'EXISTS',
    'AS',
    'ASC',
    'DESC',
    'TOP',
    'DISTINCT',
    'VALUE',
    'TRUE',
    'FALSE',
    'NULL',
    'UNDEFINED',
    'ORDER BY RANK',
]);

/**
 * Extracts the alias used in the FROM clause from the token stream.
 * Falls back to `"c"` when no FROM is found.
 */
function parseFromAlias(tokens: Token[]): string {
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.type === 'keyword' && tok.value.toUpperCase() === 'FROM') {
            // Next non-comment token is the source name
            const source = tokens[i + 1];
            if (!source || source.type === 'keyword') return 'c';

            // Check for AS alias or positional alias
            const next = tokens[i + 2];
            if (next) {
                if (next.type === 'keyword' && next.value.toUpperCase() === 'AS') {
                    const aliasToken = tokens[i + 3];
                    if (aliasToken && aliasToken.type === 'identifier') {
                        return aliasToken.value;
                    }
                } else if (next.type === 'identifier') {
                    // FROM container alias — make sure alias isn't a keyword
                    if (!KEYWORD_UPPER_SET.has(next.value.toUpperCase())) {
                        return next.value;
                    }
                }
            }
            // Just FROM <name> — use name as alias
            return source.value;
        }
    }
    return 'c';
}

// ─── JOIN alias extraction ──────────────────────────────────────────────────────

/**
 * Extracts all JOIN aliases from the token stream.
 * Pattern: JOIN <alias> IN <source>.<path>...
 */
function parseJoinAliases(tokens: Token[]): JoinAlias[] {
    const aliases: JoinAlias[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.type !== 'keyword' || tok.value.toUpperCase() !== 'JOIN') continue;

        // Expect: JOIN <alias> IN <dotPath>
        const aliasToken = tokens[i + 1];
        const inToken = tokens[i + 2];

        if (
            !aliasToken ||
            !inToken ||
            aliasToken.type !== 'identifier' ||
            inToken.type !== 'keyword' ||
            inToken.value.toUpperCase() !== 'IN'
        ) {
            continue;
        }

        // Collect the dot path: ident . ident . ident ...
        const dotPath = collectDotPath(tokens, i + 3);
        if (dotPath.length === 0) continue;

        const sourceAlias = dotPath[0];
        const propertyPath = dotPath.slice(1);

        aliases.push({
            alias: aliasToken.value,
            sourceAlias,
            propertyPath,
        });
    }

    return aliases;
}

/**
 * Collects a dot-separated path starting at token index `start`.
 * Returns the segments (e.g. `["c", "sizes"]` for `c.sizes`).
 */
function collectDotPath(tokens: Token[], start: number): string[] {
    const segments: string[] = [];
    let i = start;

    if (i >= tokens.length) return segments;
    const first = tokens[i];
    if (first.type !== 'identifier' && first.type !== 'keyword') return segments;
    segments.push(first.value);
    i++;

    while (i + 1 < tokens.length) {
        const dot = tokens[i];
        const next = tokens[i + 1];
        if (
            dot.type === 'punctuation' &&
            dot.value === '.' &&
            (next.type === 'identifier' || next.type === 'keyword')
        ) {
            segments.push(next.value);
            i += 2;
        } else {
            break;
        }
    }

    return segments;
}

// ─── Clause and cursor analysis ─────────────────────────────────────────────────

/** Clause keyword token values mapped to ClauseType. */
const CLAUSE_KEYWORD_MAP: ReadonlyMap<string, ClauseType> = new Map([
    ['SELECT', 'select'],
    ['FROM', 'from'],
    ['WHERE', 'where'],
    ['ORDER BY', 'orderby'],
    ['ORDER BY RANK', 'orderby'],
    ['GROUP BY', 'groupby'],
    ['JOIN', 'join'],
    ['OFFSET', 'offset'],
    ['LIMIT', 'limit'],
]);

interface AnalysisResult {
    clause: ClauseType;
    subPosition: SubPosition;
    insideFunction: { name: string; argIndex: number } | null;
    insideParenDepth: number;
    precedingToken: string | null;
}

/**
 * Walks tokens that appear before the cursor to determine:
 * - Which clause the cursor is in (top-level, outside parentheses)
 * - Sub-position within the clause
 * - Whether we're inside a function call (with arg index)
 * - Parenthesis depth and preceding token
 */
function analyzeTokensBeforeCursor(tokens: Token[], _cursorInBlock: number): AnalysisResult {
    let lastTopLevelClause: ClauseType = 'none';
    let lastTopLevelClauseIdx = -1;
    let parenDepth = 0;

    // Track function call stack for detecting argument context
    const funcCallStack: { name: string; argIndex: number }[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];

        // Track parenthesis depth
        if (tok.type === 'punctuation' && tok.value === '(') {
            // Check if the preceding token is a function name
            if (i > 0) {
                const prev = tokens[i - 1];
                if (prev.type === 'function') {
                    funcCallStack.push({ name: prev.value.toUpperCase(), argIndex: 0 });
                } else {
                    funcCallStack.push({ name: '', argIndex: 0 }); // non-function parens
                }
            } else {
                funcCallStack.push({ name: '', argIndex: 0 });
            }
            parenDepth++;
            continue;
        }

        if (tok.type === 'punctuation' && tok.value === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            if (funcCallStack.length > 0) {
                funcCallStack.pop();
            }
            continue;
        }

        if (tok.type === 'punctuation' && tok.value === ',' && funcCallStack.length > 0) {
            funcCallStack[funcCallStack.length - 1].argIndex++;
            continue;
        }

        // Only consider clause keywords at top level (parenDepth === 0)
        if (parenDepth === 0 && tok.type === 'keyword') {
            const clauseType = CLAUSE_KEYWORD_MAP.get(tok.value.toUpperCase());
            if (clauseType) {
                lastTopLevelClause = clauseType;
                lastTopLevelClauseIdx = i;
            }
        }
    }

    // Determine sub-position from tokens after the last clause keyword
    const tokensAfterClause =
        lastTopLevelClauseIdx >= 0 ? tokens.slice(lastTopLevelClauseIdx + 1).filter((t) => t.type !== 'comment') : [];

    const subPosition = determineSubPosition(lastTopLevelClause, tokensAfterClause);

    // Determine function context from the stack
    const insideFunction =
        funcCallStack.length > 0 && funcCallStack[funcCallStack.length - 1].name
            ? funcCallStack[funcCallStack.length - 1]
            : null;

    // Preceding token
    const lastToken = tokens.length > 0 ? tokens[tokens.length - 1] : null;
    const precedingToken = lastToken ? lastToken.value.toLowerCase() : null;

    return {
        clause: lastTopLevelClause,
        subPosition,
        insideFunction,
        insideParenDepth: parenDepth,
        precedingToken,
    };
}

/**
 * Determines the sub-position within a clause based on the non-comment tokens
 * that follow the clause keyword.
 */
function determineSubPosition(clause: ClauseType, tokensAfterClause: Token[]): SubPosition {
    // Filter out only semantically meaningful tokens (skip comments, they're already filtered)
    const meaningful = tokensAfterClause.filter((t) => t.type !== 'comment');

    if (meaningful.length === 0) {
        return 'initial';
    }

    switch (clause) {
        case 'select':
            if (meaningful[0].type === 'punctuation' && meaningful[0].value === '*') {
                return 'post-star';
            }
            return 'post-expression';

        case 'from':
            // After FROM <alias>, look for at least one identifier
            if (meaningful.length > 0 && (meaningful[0].type === 'identifier' || meaningful[0].type === 'keyword')) {
                return 'post-alias';
            }
            return 'initial';

        case 'orderby':
        case 'groupby':
            return meaningful.length > 0 ? 'post-expression' : 'initial';

        default:
            return meaningful.length > 0 ? 'post-expression' : 'initial';
    }
}
