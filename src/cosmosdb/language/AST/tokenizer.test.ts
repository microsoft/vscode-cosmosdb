/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tokenize } from './tokenizer';

describe('AST Tokenizer', () => {
    describe('basic token types', () => {
        it('tokenizes a simple SELECT keyword', () => {
            const tokens = tokenize('SELECT');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'SELECT', start: 0, end: 6 });
        });

        it('tokenizes an identifier', () => {
            const tokens = tokenize('myAlias');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'identifier', value: 'myAlias' });
        });

        it('tokenizes a function name', () => {
            const tokens = tokenize('CONTAINS');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'function', value: 'CONTAINS' });
        });

        it('tokenizes a number literal', () => {
            const tokens = tokenize('42');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'number', value: '42' });
        });

        it('tokenizes a decimal number', () => {
            const tokens = tokenize('3.14');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'number', value: '3.14' });
        });

        it('tokenizes scientific notation', () => {
            const tokens = tokenize('1.5e10');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'number', value: '1.5e10' });
        });

        it('tokenizes a single-quoted string', () => {
            const tokens = tokenize("'hello world'");
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'string', value: "'hello world'" });
        });

        it('tokenizes a double-quoted string', () => {
            const tokens = tokenize('"hello world"');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'string', value: '"hello world"' });
        });

        it('tokenizes operators', () => {
            const tokens = tokenize('!=');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'operator', value: '!=' });
        });

        it('tokenizes comparison operators', () => {
            for (const op of ['=', '!=', '>=', '<=', '<', '>', '<>']) {
                const tokens = tokenize(op);
                expect(tokens).toHaveLength(1);
                expect(tokens[0].type).toBe('operator');
            }
        });

        it('tokenizes ?? (null coalescing) operator', () => {
            const tokens = tokenize('??');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'operator', value: '??' });
        });

        it('tokenizes punctuation', () => {
            const tokens = tokenize('(');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'punctuation', value: '(' });
        });

        it('tokenizes semicolon as punctuation', () => {
            const tokens = tokenize(';');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'punctuation', value: ';' });
        });

        it('tokenizes * as punctuation', () => {
            const tokens = tokenize('*');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'punctuation', value: '*' });
        });

        it('tokenizes dot as punctuation', () => {
            const tokens = tokenize('.');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'punctuation', value: '.' });
        });
    });

    describe('comments', () => {
        it('tokenizes line comment', () => {
            const tokens = tokenize('-- this is a comment');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'comment', value: '-- this is a comment' });
        });

        it('tokenizes block comment', () => {
            const tokens = tokenize('/* block comment */');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'comment', value: '/* block comment */' });
        });

        it('handles unclosed block comment gracefully', () => {
            const tokens = tokenize('/* unclosed comment');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'comment' });
        });

        it('tokenizes code with inline comment', () => {
            const tokens = tokenize('SELECT -- get data\n*');
            expect(tokens).toHaveLength(3);
            expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'SELECT' });
            expect(tokens[1]).toMatchObject({ type: 'comment' });
            expect(tokens[2]).toMatchObject({ type: 'punctuation', value: '*' });
        });
    });

    describe('string edge cases', () => {
        it('handles SQL-style escaped single quotes', () => {
            const tokens = tokenize("'it''s'");
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'string', value: "'it''s'" });
        });

        it('handles backslash-escaped characters in strings', () => {
            const tokens = tokenize("'hello\\nworld'");
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'string' });
        });

        it('handles unclosed single-quoted string', () => {
            const tokens = tokenize("'unclosed");
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'string' });
        });

        it('handles unclosed double-quoted string', () => {
            const tokens = tokenize('"unclosed');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'string' });
        });

        it('string with semicolon inside', () => {
            const tokens = tokenize("'hello;world'");
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'string' });
        });
    });

    describe('multi-word keywords', () => {
        it('merges ORDER BY into a single token', () => {
            const tokens = tokenize('ORDER BY');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'ORDER BY' });
        });

        it('merges GROUP BY into a single token', () => {
            const tokens = tokenize('GROUP BY');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'GROUP BY' });
        });

        it('merges ORDER BY RANK into a single token', () => {
            const tokens = tokenize('ORDER BY RANK');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'ORDER BY RANK' });
        });

        it('merges ORDER BY even with extra whitespace', () => {
            const tokens = tokenize('ORDER   BY');
            // The tokenizer produces separate tokens which are then merged
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'ORDER BY' });
        });

        it('merges ORDER BY when separated by a comment', () => {
            const tokens = tokenize('ORDER /* comment */ BY');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'ORDER BY' });
        });
    });

    describe('full query tokenization', () => {
        it('tokenizes a simple SELECT query', () => {
            const tokens = tokenize('SELECT * FROM c');
            const types = tokens.map((t) => t.type);
            const values = tokens.map((t) => t.value);
            expect(types).toEqual(['keyword', 'punctuation', 'keyword', 'identifier']);
            expect(values).toEqual(['SELECT', '*', 'FROM', 'c']);
        });

        it('tokenizes a query with WHERE clause', () => {
            const tokens = tokenize('SELECT * FROM c WHERE c.age > 10');
            expect(tokens.length).toBeGreaterThan(0);
            expect(tokens.map((t) => t.type)).toContain('keyword');
            expect(tokens.map((t) => t.type)).toContain('operator');
            expect(tokens.map((t) => t.type)).toContain('number');
        });

        it('tokenizes a query with function call', () => {
            const tokens = tokenize("SELECT * FROM c WHERE CONTAINS(c.name, 'test')");
            const funcTokens = tokens.filter((t) => t.type === 'function');
            expect(funcTokens).toHaveLength(1);
            expect(funcTokens[0].value).toBe('CONTAINS');
        });

        it('tokenizes a query with JOIN', () => {
            const tokens = tokenize('SELECT * FROM c JOIN s IN c.sizes');
            const keywords = tokens.filter((t) => t.type === 'keyword').map((t) => t.value);
            expect(keywords).toContain('SELECT');
            expect(keywords).toContain('FROM');
            expect(keywords).toContain('JOIN');
            expect(keywords).toContain('IN');
        });

        it('tokenizes multi-query with semicolons', () => {
            const tokens = tokenize('SELECT 1; SELECT 2');
            const semicolons = tokens.filter((t) => t.type === 'punctuation' && t.value === ';');
            expect(semicolons).toHaveLength(1);
        });

        it('preserves accurate start/end offsets', () => {
            const text = 'SELECT * FROM c';
            const tokens = tokenize(text);
            for (const tok of tokens) {
                expect(text.substring(tok.start, tok.end)).toBe(
                    tok.value === 'ORDER BY' ? text.substring(tok.start, tok.end) : tok.value,
                );
            }
        });
    });

    describe('empty and edge cases', () => {
        it('returns empty array for empty string', () => {
            expect(tokenize('')).toEqual([]);
        });

        it('returns empty array for whitespace-only input', () => {
            expect(tokenize('   \n\t  ')).toEqual([]);
        });

        it('handles single character input', () => {
            const tokens = tokenize('(');
            expect(tokens).toHaveLength(1);
        });
    });
});
