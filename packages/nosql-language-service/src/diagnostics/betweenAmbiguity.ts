/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// BETWEEN + AND ambiguity detection.
//
// The CosmosDB NoSQL parser (mirroring the native C++ sql.y grammar) treats
// the AND keyword greedily inside a BETWEEN expression:
//
//   a BETWEEN low AND high AND b = 3
//   ├────────────────────────┘  ↑
//   BETWEEN sees this AND ─────── …and then fails on this second AND
//
// To combine BETWEEN with a logical AND the expression must be parenthesised:
//
//   (a BETWEEN low AND high) AND b = 3   ← correct
//
// This module scans the token stream and emits a Warning squiggle on the
// BETWEEN keyword whenever it detects an unparenthesised `BETWEEN…AND…AND`
// pattern at the same nesting depth.
// ---------------------------------------------------------------------------

import { type IToken } from 'chevrotain';
import { type SourceRange } from '../errors/SqlError.js';
import { SqlLexer } from '../lexer/SqlLexer.js';
import * as T from '../lexer/tokens.js';

// ========================== Public types ======================================

export interface BetweenAmbiguityWarning {
    /** Source range of the BETWEEN keyword */
    range: SourceRange;
    /** Human-readable warning message */
    message: string;
}

// ========================== Token helpers =====================================

/** Top-level clause keywords that terminate the high expression of BETWEEN. */
function isClauseTerminator(tok: IToken): boolean {
    return (
        tok.tokenType === T.Group ||
        tok.tokenType === T.Order ||
        tok.tokenType === T.Offset ||
        tok.tokenType === T.Limit ||
        tok.tokenType === T.Select ||
        tok.tokenType === T.From ||
        tok.tokenType === T.Having
    );
}

function tokenRange(tok: IToken): SourceRange {
    const startLine = tok.startLine ?? 1;
    const startCol = tok.startColumn ?? 1;
    const endOffset = (tok.endOffset ?? tok.startOffset + tok.image.length - 1) + 1;
    return {
        start: { offset: tok.startOffset, line: startLine, col: startCol },
        end: {
            offset: endOffset,
            line: tok.endLine ?? startLine,
            col: (tok.endColumn ?? startCol + tok.image.length - 1) + 1,
        },
    };
}

// ========================== Main entry point ==================================

/**
 * Scan `query` for unparenthesised `BETWEEN … AND … AND` patterns and return
 * a warning for each one found.
 *
 * Returns an empty array when no ambiguous BETWEEN usage is detected.
 */
export function detectBetweenAmbiguity(query: string): BetweenAmbiguityWarning[] {
    const { tokens } = SqlLexer.tokenize(query);
    const warnings: BetweenAmbiguityWarning[] = [];

    // Track nesting depth across the whole token stream.
    let depth = 0;

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];

        if (tok.tokenType === T.LParen || tok.tokenType === T.LBracket || tok.tokenType === T.LBrace) {
            depth++;
            continue;
        }
        if (tok.tokenType === T.RParen || tok.tokenType === T.RBracket || tok.tokenType === T.RBrace) {
            depth--;
            continue;
        }

        if (tok.tokenType !== T.Between) continue;

        // ── Found BETWEEN at `betweenDepth` ──────────────────────────────────
        const betweenDepth = depth;
        const betweenToken = tok;

        // Step 1: find the BETWEEN separator AND at the same depth.
        let separatorIdx = -1;
        let scanDepth = betweenDepth;

        for (let j = i + 1; j < tokens.length; j++) {
            const t = tokens[j];
            if (t.tokenType === T.LParen || t.tokenType === T.LBracket || t.tokenType === T.LBrace) {
                scanDepth++;
                continue;
            }
            if (t.tokenType === T.RParen || t.tokenType === T.RBracket || t.tokenType === T.RBrace) {
                scanDepth--;
                // If depth drops below betweenDepth we have left the enclosing
                // expression — the BETWEEN is fully contained in parens, skip.
                if (scanDepth < betweenDepth) break;
                continue;
            }
            if (t.tokenType === T.And && scanDepth === betweenDepth) {
                separatorIdx = j;
                break;
            }
            // A clause keyword at the same depth before any AND means malformed
            // BETWEEN — the parser will already report an error, skip.
            if (scanDepth === betweenDepth && isClauseTerminator(t)) break;
        }

        if (separatorIdx === -1) continue;

        // Step 2: scan past the high expression.  The first token at
        // `betweenDepth` that is AND (logical) or a clause terminator signals
        // what follows BETWEEN … AND high.
        scanDepth = betweenDepth;

        for (let k = separatorIdx + 1; k < tokens.length; k++) {
            const t = tokens[k];
            if (t.tokenType === T.LParen || t.tokenType === T.LBracket || t.tokenType === T.LBrace) {
                scanDepth++;
                continue;
            }
            if (t.tokenType === T.RParen || t.tokenType === T.RBracket || t.tokenType === T.RBrace) {
                scanDepth--;
                // Exited enclosing scope — the BETWEEN itself is parenthesised,
                // no ambiguity at this level.
                if (scanDepth < betweenDepth) break;
                continue;
            }

            if (scanDepth !== betweenDepth) continue;

            // Logical AND at the same depth immediately after the high
            // expression — this is the ambiguous case.
            if (t.tokenType === T.And) {
                warnings.push({
                    range: tokenRange(betweenToken),
                    message:
                        'BETWEEN combined with AND is ambiguous. ' +
                        'Wrap the BETWEEN expression in parentheses: ' +
                        '(expr BETWEEN low AND high) AND …',
                });
                break;
            }

            // Clause terminator ends the expression cleanly — no ambiguity.
            if (isClauseTerminator(t)) break;
        }
    }

    return warnings;
}

