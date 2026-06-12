/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringStream } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { cosmosDbSqlStreamParser } from './streamParser.js';

interface Token {
    text: string;
    type: string | null;
}

/**
 * Tokenize a single line, threading the parser state. Returns the tokens and
 * the resulting state so multi-line contexts (strings, block comments) can be
 * tested across lines.
 */
function tokenizeLine(line: string, state = cosmosDbSqlStreamParser.startState!(4)) {
    const stream = new StringStream(line, 4, 4);
    const tokens: Token[] = [];
    let guard = 0;
    while (!stream.eol() && guard++ < 1000) {
        const start = stream.pos;
        const type = cosmosDbSqlStreamParser.token(stream, state);
        if (stream.pos === start) {
            // Defensive: avoid an infinite loop if the parser failed to advance.
            stream.next();
        }
        tokens.push({ text: line.slice(start, stream.pos), type });
    }
    return { tokens, state };
}

/** Convenience: tokenize a single-token line and return its type. */
function typeOf(line: string): string | null {
    const { tokens } = tokenizeLine(line);
    // Filter out whitespace tokens (null type from eatSpace).
    const nonNull = tokens.filter((t) => t.type !== null);
    return nonNull.length === 1 ? nonNull[0].type : nonNull.map((t) => t.type).join(',');
}

describe('cosmosDbSqlStreamParser', () => {
    it('starts in the top context', () => {
        expect(cosmosDbSqlStreamParser.startState!(4)).toEqual({ context: 'top' });
    });

    it('classifies keywords, operator keywords, builtins and identifiers', () => {
        expect(typeOf('SELECT')).toBe('keyword');
        expect(typeOf('AND')).toBe('operatorKeyword');
        expect(typeOf('COUNT')).toBe('function(definition)');
        expect(typeOf('myField')).toBe('variableName');
    });

    it('classifies numbers (int, hex, float, exponent)', () => {
        expect(typeOf('123')).toBe('number');
        expect(typeOf('0xFF')).toBe('number');
        expect(typeOf('3.14')).toBe('number');
        expect(typeOf('1e5')).toBe('number');
    });

    it('classifies operators, parens and punctuation', () => {
        expect(typeOf('>=')).toBe('operator');
        expect(typeOf('||')).toBe('operator');
        expect(typeOf('+')).toBe('operator');
        expect(typeOf('(')).toBe('paren');
        expect(typeOf(',')).toBe('punctuation');
    });

    it('classifies line comments', () => {
        expect(typeOf('-- a comment')).toBe('lineComment');
    });

    it('classifies a single-line block comment and returns to top', () => {
        const { tokens, state } = tokenizeLine('/* hi */');
        expect(tokens[0].type).toBe('blockComment');
        expect(state.context).toBe('top');
    });

    it('continues a block comment across lines', () => {
        const first = tokenizeLine('/* start');
        expect(first.state.context).toBe('blockComment');
        const second = tokenizeLine('end */', first.state);
        // The comment terminator is consumed and the parser returns to the top context.
        expect(second.tokens[0].type).toBe('blockComment');
        expect(second.state.context).toBe('top');
    });

    it('classifies single-quoted strings, including escaped quotes', () => {
        expect(typeOf("'abc'")).toBe('string');
        expect(typeOf("'a''b'")).toBe('string');
    });

    it('continues an unterminated single-quoted string across lines', () => {
        const first = tokenizeLine("'abc");
        expect(first.state.context).toBe('singleString');
        const second = tokenizeLine("def'", first.state);
        expect(second.tokens[0].type).toBe('string');
        expect(second.state.context).toBe('top');
    });

    it('classifies double-quoted identifiers as string.special', () => {
        expect(typeOf('"ident"')).toBe('string.special');
    });

    it('continues an unterminated quoted identifier across lines', () => {
        const first = tokenizeLine('"abc');
        expect(first.state.context).toBe('quotedIdentifier');
        const second = tokenizeLine('def"', first.state);
        expect(second.tokens[0].type).toBe('string.special');
        expect(second.state.context).toBe('top');
    });

    it('returns null for whitespace-only input', () => {
        const { tokens } = tokenizeLine('   ');
        expect(tokens.every((t) => t.type === null)).toBe(true);
    });
});
