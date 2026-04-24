/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Post-parse typo detection for near-miss SQL keywords.
//
// Scans tokens for identifiers that look like misspelled keywords
// (e.g. "FORM" → "FROM", "WHER" → "WHERE") and emits warnings.
// Works at the token level to catch typos that the parser absorbs
// as valid identifiers (aliases, property names).
// ---------------------------------------------------------------------------

import { type IToken } from 'chevrotain';
import { type SourceRange } from '../errors/SqlError.js';
import { SqlLexer } from '../lexer/SqlLexer.js';
import * as T from '../lexer/tokens.js';

// ========================== Public types ======================================

export interface TypoWarning {
    /** The misspelled text as typed by the user */
    typed: string;
    /** The keyword we think was intended */
    suggestion: string;
    /** Source range of the misspelled token */
    range: SourceRange;
    /** Human-readable warning message */
    message: string;
}

// ========================== Clause-boundary keywords ==========================

/**
 * Only these keywords are checked for typos. They are the clause-level
 * keywords that appear at statement boundaries. We intentionally exclude
 * expression-level keywords (AND, OR, NOT, TRUE, FALSE, NULL, etc.)
 * because short words like those produce too many false positives.
 */
const CLAUSE_KEYWORDS: readonly string[] = [
    'SELECT',
    'FROM',
    'WHERE',
    'ORDER',
    'GROUP',
    'JOIN',
    'DISTINCT',
    'LIMIT',
    'OFFSET',
    'HAVING',
    'VALUE',
    'BETWEEN',
    'EXISTS',
];

// ========================== Levenshtein distance ==============================

/**
 * Compute the Levenshtein edit distance between two strings.
 * Uses the classic dynamic-programming approach with O(min(a,b)) space.
 */
function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Ensure `a` is the shorter string for space optimization
    if (a.length > b.length) {
        [a, b] = [b, a];
    }

    const aLen = a.length;
    const bLen = b.length;
    let prev = new Array<number>(aLen + 1);
    let curr = new Array<number>(aLen + 1);

    for (let i = 0; i <= aLen; i++) prev[i] = i;

    for (let j = 1; j <= bLen; j++) {
        curr[0] = j;
        for (let i = 1; i <= aLen; i++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[i] = Math.min(
                curr[i - 1] + 1, // insertion
                prev[i] + 1, // deletion
                prev[i - 1] + cost, // substitution
            );
        }
        [prev, curr] = [curr, prev];
    }

    return prev[aLen];
}

// ========================== Position checks ===================================

/**
 * Check whether a token at the given index is in a "clause-boundary" position
 * where a keyword would be syntactically plausible.
 *
 * A token is at a clause boundary if:
 * - It's the first token (could be SELECT)
 * - The previous non-skipped token is: *, Identifier, StringLiteral, NumberLiteral,
 *   RParen, RBracket, or a keyword like ASC/DESC/BY
 * - It's NOT preceded by a dot (that would be property access: c.FORM)
 * - It's NOT preceded by AS (that would be an alias: SELECT x AS FORM)
 * - It's NOT inside parentheses at depth > 0 following a function name
 */
function isClauseBoundaryPosition(tokens: IToken[], index: number): boolean {
    // First token is always a clause boundary
    if (index === 0) return true;

    const prev = tokens[index - 1];
    const prevType = prev.tokenType;

    // After a dot → property access, not a typo
    if (prevType === T.Dot) return false;

    // After AS → this is an alias, not a typo
    if (prevType === T.As) return false;

    // After a colon → object property value position, not a typo
    if (prevType === T.Colon) return false;

    // After comma within a SELECT list could be another select item, not a clause keyword
    // But after expressions that end a clause, yes
    // We check: previous token should end an expression or clause
    const endsExpression =
        prevType === T.Star ||
        prevType === T.Identifier ||
        prevType === T.StringLiteral ||
        prevType === T.NumberLiteral ||
        prevType === T.IntegerLiteral ||
        prevType === T.DoubleLiteral ||
        prevType === T.RParen ||
        prevType === T.RBracket ||
        prevType === T.True_ ||
        prevType === T.False_ ||
        prevType === T.Null_ ||
        prevType === T.Undefined_ ||
        prevType === T.Asc ||
        prevType === T.Desc ||
        prevType === T.By ||
        prevType === T.Parameter;

    // Also allow after keywords that are used as identifiers (LET, RANK)
    const endsAsIdentifier = prevType === T.Let || prevType === T.Rank || prevType === T.Left || prevType === T.Right;

    // After SELECT → modifier position (DISTINCT, TOP, VALUE)
    const afterClauseKeyword = prevType === T.Select || prevType === T.From || prevType === T.Where;

    return endsExpression || endsAsIdentifier || afterClauseKeyword;
}

// ========================== Main entry point ==================================

/**
 * Scan a query for identifiers that look like misspelled SQL keywords.
 *
 * Returns an array of warnings (never errors). Only flags identifiers:
 * - At least 3 characters long (avoids false positives on `c`, `d`, `id`)
 * - Within Levenshtein distance ≤ 2 of a clause keyword
 * - In a clause-boundary position (not after `.`, not after `AS`)
 * - Not an exact match of any keyword (those are already tokenized correctly)
 *
 * @param query - The SQL query string
 * @returns Array of typo warnings (empty if none found)
 */
export function detectTypos(query: string): TypoWarning[] {
    const lexResult = SqlLexer.tokenize(query);
    const tokens = lexResult.tokens;
    const warnings: TypoWarning[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // Only check Identifier tokens (keywords are already tokenized as their own type)
        if (token.tokenType !== T.Identifier) continue;

        const typed = token.image;
        const typedUpper = typed.toUpperCase();

        // Skip short identifiers — too many false positives
        if (typed.length < 3) continue;

        // Skip if it's in a non-boundary position
        if (!isClauseBoundaryPosition(tokens, i)) continue;

        // Find the closest keyword match
        let bestKeyword: string | undefined;
        let bestDistance = Infinity;

        for (const keyword of CLAUSE_KEYWORDS) {
            // Quick length filter — if lengths differ by more than 2, distance > 2
            if (Math.abs(typed.length - keyword.length) > 2) continue;

            const dist = levenshtein(typedUpper, keyword);
            if (dist > 0 && dist < bestDistance) {
                bestDistance = dist;
                bestKeyword = keyword;
            }
        }

        // Only flag if distance ≤ 2
        if (bestKeyword && bestDistance <= 2) {
            const startLine = token.startLine ?? 1;
            const startCol = token.startColumn ?? 1;
            const endOffset = (token.endOffset ?? token.startOffset + typed.length - 1) + 1;

            warnings.push({
                typed,
                suggestion: bestKeyword,
                range: {
                    start: { offset: token.startOffset, line: startLine, col: startCol },
                    end: {
                        offset: endOffset,
                        line: token.endLine ?? startLine,
                        col: (token.endColumn ?? startCol + typed.length - 1) + 1,
                    },
                },
                message: `Did you mean '${bestKeyword}'? '${typed}' looks like a typo.`,
            });
        }
    }

    return warnings;
}
