/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parse } from '../index.js';

/**
 * Tests for human-friendly error messages produced by {@link SqlErrorMessageProvider}.
 *
 * Each test verifies that the parser emits clear, user-readable messages
 * instead of raw Chevrotain token type names like "LParen" or "Identifier".
 */

describe('Human-friendly error messages', () => {
    // ---------------------------------------------------------------------------
    // MismatchedTokenException — "Expected X but found Y."
    // ---------------------------------------------------------------------------
    describe('MismatchedTokenException messages', () => {
        it('missing SELECT keyword', () => {
            const { errors } = parse('');
            expect(errors[0].message).toBe('Expected SELECT but found end of query.');
        });

        it('wrong keyword: HELLO instead of SELECT', () => {
            const { errors } = parse('HELLO WORLD');
            expect(errors[0].message).toBe("Expected SELECT but found 'HELLO'.");
        });

        it('missing LIMIT after OFFSET', () => {
            const { errors } = parse('SELECT * FROM c OFFSET 5');
            expect(errors[0].message).toBe('Expected LIMIT but found end of query.');
        });
    });

    // ---------------------------------------------------------------------------
    // NotAllInputParsedException — "Unexpected X after the query."
    // ---------------------------------------------------------------------------
    describe('NotAllInputParsedException messages', () => {
        it('typo FORM produces trailing-input message', () => {
            const { errors } = parse('SELECT * FORM c');
            expect(errors[0].message).toBe("Unexpected 'FORM' after the query.");
        });
    });

    // ---------------------------------------------------------------------------
    // NoViableAltException — "Unexpected X. Expected A, B, or C."
    // ---------------------------------------------------------------------------
    describe('NoViableAltException messages', () => {
        it('incomplete SELECT shows expected expression tokens', () => {
            const { errors } = parse('SELECT');
            expect(errors[0].message).toMatch(/^Unexpected end of query\. Expected .+\.$/);
        });

        it('incomplete WHERE shows expected expression tokens', () => {
            const { errors } = parse('SELECT * FROM c WHERE');
            expect(errors[0].message).toMatch(/^Unexpected end of query\. Expected .+\.$/);
        });

        it('extra comma in select list', () => {
            const { errors } = parse('SELECT c.id, , c.name FROM c');
            expect(errors[0].message).toMatch(/^Unexpected ','\..*Expected .+\.$/);
        });

        it('incomplete ORDER BY', () => {
            const { errors } = parse('SELECT * FROM c ORDER BY');
            expect(errors[0].message).toMatch(/^Unexpected end of query\. Expected .+\.$/);
        });

        it('incomplete BETWEEN', () => {
            const { errors } = parse('SELECT * FROM c WHERE c.x BETWEEN');
            expect(errors[0].message).toMatch(/^Unexpected end of query\. Expected .+\.$/);
        });

        it('incomplete IN', () => {
            const { errors } = parse('SELECT * FROM c WHERE c.x IN (');
            expect(errors[0].message).toMatch(/^Unexpected end of query\. Expected .+\.$/);
        });

        it('unclosed function call', () => {
            const { errors } = parse('SELECT COUNT(');
            expect(errors[0].message).toMatch(/^Unexpected end of query\. Expected .+\.$/);
        });
    });

    // ---------------------------------------------------------------------------
    // Messages contain no raw token type names
    // ---------------------------------------------------------------------------
    describe('No raw token type names in messages', () => {
        const rawTokenNames = [
            'LParen',
            'RParen',
            'LBracket',
            'RBracket',
            'LBrace',
            'RBrace',
            'StringLiteral',
            'NumberLiteral',
            'IntegerLiteral',
            'DoubleLiteral',
        ];

        const badQueries = [
            '',
            'SELECT',
            'SELECT * FORM c',
            'SELECT * FROM c WHERE',
            'SELECT COUNT(',
            'SELECT * FROM c ORDER BY',
            'HELLO WORLD',
            'SELECT c.id, , c.name FROM c',
            'SELECT * FROM c OFFSET 5',
            'SELECT * FROM c WHERE c.x BETWEEN',
            'SELECT * FROM c WHERE c.x IN (',
            'SELECT * FROM c WHERE c.x LIKE',
        ];

        for (const q of badQueries) {
            it(`no raw token names in errors for: "${q}"`, () => {
                const { errors } = parse(q);
                for (const e of errors) {
                    for (const raw of rawTokenNames) {
                        expect(e.message).not.toContain(raw);
                    }
                }
            });
        }
    });

    // ---------------------------------------------------------------------------
    // Token display-name mapping verification
    // ---------------------------------------------------------------------------
    describe('Token display names are used', () => {
        it('uses human-readable punctuation names', () => {
            // "SELECT * FROM c OFFSET 5" → "Expected LIMIT but found end of query."
            // This tests that keywords show as uppercase names
            const { errors } = parse('SELECT * FROM c OFFSET 5');
            expect(errors[0].message).toContain('LIMIT');
        });

        it("uses 'end of query' for EOF tokens", () => {
            const { errors } = parse('');
            expect(errors[0].message).toContain('end of query');
        });

        it("uses 'end of query' for incomplete expressions", () => {
            const { errors } = parse('SELECT * FROM c WHERE');
            expect(errors[0].message).toContain('end of query');
        });
    });

    // ---------------------------------------------------------------------------
    // Expected list formatting
    // ---------------------------------------------------------------------------
    describe('Expected list formatting', () => {
        it('long alternatives are truncated with "..."', () => {
            // SELECT alone triggers NoViableAlt with many alternatives → truncated
            const { errors } = parse('SELECT');
            // Should contain ", ..." to indicate truncation
            expect(errors[0].message).toContain(', ...');
        });

        it('uses "or" before the last item', () => {
            const { errors } = parse('SELECT');
            // Message should contain "or" in the expected list
            expect(errors[0].message).toMatch(/, or /);
        });
    });
});

