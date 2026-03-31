/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getCursorContext } from './parser';

// Helper: cursor at end of text
const ctx = (text: string) => getCursorContext(text, text.length);

describe('AST Parser — getCursorContext', () => {
    // ─── Query Block Splitting ──────────────────────────────────────────────

    describe('query block isolation', () => {
        it('returns the full text when there are no semicolons', () => {
            const text = 'SELECT * FROM c WHERE c.age > 10';
            const result = getCursorContext(text, 15);
            expect(result.queryBlockText).toBe(text);
        });

        it('returns the first query block when cursor is in the first block', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            const result = getCursorContext(text, 5);
            expect(result.queryBlockText).toBe('SELECT * FROM c');
        });

        it('returns the second query block when cursor is in the second block', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            const result = getCursorContext(text, 17);
            expect(result.queryBlockText).toBe(' SELECT * FROM d');
        });

        it('handles cursor at the very start of the document', () => {
            const result = getCursorContext('SELECT * FROM c; SELECT * FROM d', 0);
            expect(result.queryBlockText).toBe('SELECT * FROM c');
        });

        it('handles cursor at the very end of the document', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            const result = getCursorContext(text, text.length);
            expect(result.queryBlockText).toBe(' SELECT * FROM d');
        });

        it('ignores semicolons inside single-quoted strings', () => {
            const text = "SELECT * FROM c WHERE c.name = 'hello;world'; SELECT * FROM d";
            const result = getCursorContext(text, 47);
            expect(result.queryBlockText).toBe(' SELECT * FROM d');
        });

        it('ignores semicolons inside double-quoted strings', () => {
            const text = 'SELECT * FROM c WHERE c.name = "hello;world"; SELECT * FROM d';
            const result = getCursorContext(text, 47);
            expect(result.queryBlockText).toBe(' SELECT * FROM d');
        });

        it('ignores semicolons inside line comments', () => {
            const text = 'SELECT * FROM c -- this is a comment;\nWHERE c.age > 10; SELECT 1';
            const result = getCursorContext(text, 5);
            expect(result.queryBlockText).toContain('SELECT * FROM c');
            expect(result.queryBlockText).toContain('WHERE c.age > 10');
        });

        it('ignores semicolons inside block comments', () => {
            const text = 'SELECT * FROM c /* comment with ; semicolon */ WHERE c.age > 10; SELECT 1';
            const result = getCursorContext(text, 5);
            expect(result.queryBlockText).toContain('SELECT * FROM c');
            expect(result.queryBlockText).toContain('WHERE c.age > 10');
        });

        it('handles empty text', () => {
            const result = getCursorContext('', 0);
            expect(result.queryBlockText).toBe('');
        });

        it('handles multiple consecutive semicolons', () => {
            const text = 'SELECT 1;; SELECT 2';
            expect(getCursorContext(text, 8).queryBlockText).toBe('SELECT 1');
            expect(getCursorContext(text, 9).queryBlockText).toBe('');
        });
    });

    // ─── Clause Context Detection ───────────────────────────────────────────

    describe('clause detection', () => {
        it('returns "none" for empty text', () => {
            expect(ctx('')).toMatchObject({ clause: 'none', subPosition: 'initial' });
        });

        it('returns "none" before any clause keyword', () => {
            expect(ctx('  ')).toMatchObject({ clause: 'none' });
        });

        it('detects SELECT clause (initial)', () => {
            expect(ctx('SELECT ')).toMatchObject({ clause: 'select', subPosition: 'initial' });
        });

        it('detects SELECT clause (post-star)', () => {
            expect(ctx('SELECT * ')).toMatchObject({ clause: 'select', subPosition: 'post-star' });
        });

        it('detects SELECT clause (post-expression)', () => {
            expect(ctx('SELECT c.name, ')).toMatchObject({ clause: 'select', subPosition: 'post-expression' });
        });

        it('detects FROM clause (initial)', () => {
            expect(ctx('SELECT * FROM ')).toMatchObject({ clause: 'from', subPosition: 'initial' });
        });

        it('detects FROM clause (post-alias)', () => {
            expect(ctx('SELECT * FROM c ')).toMatchObject({ clause: 'from', subPosition: 'post-alias' });
        });

        it('detects WHERE clause (initial)', () => {
            expect(ctx('SELECT * FROM c WHERE ')).toMatchObject({ clause: 'where', subPosition: 'initial' });
        });

        it('detects WHERE clause (post-expression)', () => {
            expect(ctx('SELECT * FROM c WHERE c.age > ')).toMatchObject({
                clause: 'where',
                subPosition: 'post-expression',
            });
        });

        it('detects ORDER BY clause (initial)', () => {
            expect(ctx('SELECT * FROM c ORDER BY ')).toMatchObject({
                clause: 'orderby',
                subPosition: 'initial',
            });
        });

        it('detects ORDER BY clause (post-expression)', () => {
            expect(ctx('SELECT * FROM c ORDER BY c.name ')).toMatchObject({
                clause: 'orderby',
                subPosition: 'post-expression',
            });
        });

        it('detects ORDER BY RANK', () => {
            expect(ctx('SELECT * FROM c ORDER BY RANK ')).toMatchObject({
                clause: 'orderby',
                subPosition: 'initial',
            });
        });

        it('detects GROUP BY clause (initial)', () => {
            expect(ctx('SELECT * FROM c GROUP BY ')).toMatchObject({
                clause: 'groupby',
                subPosition: 'initial',
            });
        });

        it('detects GROUP BY clause (post-expression)', () => {
            expect(ctx('SELECT * FROM c GROUP BY c.type ')).toMatchObject({
                clause: 'groupby',
                subPosition: 'post-expression',
            });
        });

        it('detects JOIN clause', () => {
            expect(ctx('SELECT * FROM c JOIN ')).toMatchObject({ clause: 'join', subPosition: 'initial' });
        });

        it('detects OFFSET clause', () => {
            expect(ctx('SELECT * FROM c OFFSET ')).toMatchObject({ clause: 'offset', subPosition: 'initial' });
        });

        it('detects LIMIT clause', () => {
            expect(ctx('SELECT * FROM c OFFSET 10 LIMIT ')).toMatchObject({
                clause: 'limit',
                subPosition: 'initial',
            });
        });
    });

    // ─── hasGroupBy ─────────────────────────────────────────────────────────

    describe('hasGroupBy', () => {
        it('detects GROUP BY in the full query block', () => {
            const text = 'SELECT c.type, COUNT(1) FROM c GROUP BY c.type';
            const result = getCursorContext(text, 7);
            expect(result.hasGroupBy).toBe(true);
        });

        it('is false when no GROUP BY', () => {
            expect(ctx('SELECT * FROM c WHERE c.age > 10').hasGroupBy).toBe(false);
        });

        it('is false when GROUP BY is inside a line comment', () => {
            const text = 'SELECT * FROM c -- GROUP BY c.type\nWHERE c.age > 10 ';
            expect(ctx(text).hasGroupBy).toBe(false);
        });

        it('is false when GROUP BY is inside a block comment', () => {
            const text = 'SELECT * FROM c /* GROUP BY c.type */ WHERE c.age > 10 ';
            expect(ctx(text).hasGroupBy).toBe(false);
        });

        it('is true when GROUP BY is outside comments', () => {
            const text = 'SELECT c.type, COUNT(1) FROM c /* filter */ GROUP BY c.type';
            const result = getCursorContext(text, 7);
            expect(result.hasGroupBy).toBe(true);
        });
    });

    // ─── Nested parentheses ─────────────────────────────────────────────────

    describe('nested parentheses', () => {
        it('does not confuse clause keywords inside function parentheses', () => {
            expect(ctx('SELECT * FROM c WHERE CONTAINS(').clause).toBe('where');
        });

        it('handles nested function calls', () => {
            expect(ctx('SELECT * FROM c WHERE LOWER(CONTAINS(').clause).toBe('where');
        });

        it('clause detection ignores keywords inside unclosed parens', () => {
            expect(ctx('SELECT * FROM c WHERE (SELECT ').clause).toBe('where');
        });
    });

    // ─── Keywords in strings ────────────────────────────────────────────────

    describe('keywords in strings', () => {
        it('ignores clause keywords inside string literals', () => {
            expect(ctx("SELECT * FROM c WHERE c.name = 'SELECT FROM WHERE' AND ").clause).toBe('where');
        });
    });

    // ─── Keywords in comments ───────────────────────────────────────────────

    describe('keywords in comments', () => {
        it('ignores clause keywords inside line comments', () => {
            expect(ctx('SELECT * FROM c -- WHERE clause\nWHERE ')).toMatchObject({
                clause: 'where',
                subPosition: 'initial',
            });
        });

        it('ignores clause keywords inside block comments', () => {
            expect(ctx('SELECT * FROM c /* WHERE */ ORDER BY ')).toMatchObject({
                clause: 'orderby',
                subPosition: 'initial',
            });
        });
    });

    // ─── precedingToken ─────────────────────────────────────────────────────

    describe('precedingToken', () => {
        it('returns the preceding operator token', () => {
            expect(ctx('SELECT * FROM c WHERE c.age > ').precedingToken).toBe('>');
        });

        it('returns keyword as preceding token', () => {
            expect(ctx('SELECT * FROM c WHERE ').precedingToken).toBe('where');
        });

        it('returns null for empty text', () => {
            expect(ctx('').precedingToken).toBeNull();
        });
    });

    // ─── FROM Alias Extraction ──────────────────────────────────────────────

    describe('fromAlias', () => {
        it('extracts simple alias', () => {
            expect(ctx('SELECT * FROM c').fromAlias).toBe('c');
        });

        it('extracts named alias', () => {
            expect(ctx('SELECT * FROM container').fromAlias).toBe('container');
        });

        it('extracts AS alias', () => {
            expect(ctx('SELECT * FROM c AS doc').fromAlias).toBe('doc');
        });

        it('extracts positional alias', () => {
            expect(ctx('SELECT * FROM container c').fromAlias).toBe('c');
        });

        it('falls back to "c" when no FROM', () => {
            expect(ctx('SELECT *').fromAlias).toBe('c');
        });

        it('falls back to "c" for empty text', () => {
            expect(ctx('').fromAlias).toBe('c');
        });

        it('ignores FROM inside a line comment', () => {
            expect(ctx('-- FROM fake\nSELECT * FROM c').fromAlias).toBe('c');
        });

        it('ignores FROM inside a block comment', () => {
            expect(ctx('/* FROM fake */ SELECT * FROM c').fromAlias).toBe('c');
        });

        it('only picks the real FROM when a commented FROM comes first', () => {
            expect(ctx('/* FROM wrong AS w */ SELECT * FROM container AS doc').fromAlias).toBe('doc');
        });
    });

    // ─── JOIN Alias Extraction ──────────────────────────────────────────────

    describe('joinAliases', () => {
        it('extracts a single JOIN alias', () => {
            const result = ctx('SELECT * FROM c JOIN s IN c.sizes');
            expect(result.joinAliases).toHaveLength(1);
            expect(result.joinAliases[0]).toEqual({ alias: 's', sourceAlias: 'c', propertyPath: ['sizes'] });
        });

        it('extracts chained JOIN aliases', () => {
            const result = ctx('SELECT * FROM c JOIN s IN c.sizes JOIN v IN s.variants');
            expect(result.joinAliases).toHaveLength(2);
            expect(result.joinAliases[0]).toEqual({ alias: 's', sourceAlias: 'c', propertyPath: ['sizes'] });
            expect(result.joinAliases[1]).toEqual({ alias: 'v', sourceAlias: 's', propertyPath: ['variants'] });
        });

        it('handles nested property path', () => {
            const result = ctx('SELECT * FROM c JOIN x IN c.nested.items');
            expect(result.joinAliases).toHaveLength(1);
            expect(result.joinAliases[0]).toEqual({
                alias: 'x',
                sourceAlias: 'c',
                propertyPath: ['nested', 'items'],
            });
        });

        it('returns empty when no JOIN', () => {
            expect(ctx('SELECT * FROM c WHERE c.age > 10').joinAliases).toEqual([]);
        });

        it('returns empty for empty text', () => {
            expect(ctx('').joinAliases).toEqual([]);
        });

        it('ignores JOIN inside a line comment', () => {
            const result = ctx('-- JOIN fake IN c.items\nSELECT * FROM c JOIN s IN c.sizes');
            expect(result.joinAliases).toHaveLength(1);
            expect(result.joinAliases[0].alias).toBe('s');
        });

        it('ignores JOIN inside a block comment', () => {
            const result = ctx('/* JOIN fake IN c.items */ SELECT * FROM c JOIN s IN c.sizes');
            expect(result.joinAliases).toHaveLength(1);
            expect(result.joinAliases[0].alias).toBe('s');
        });

        it('ignores JOIN inside a mid-query block comment', () => {
            const result = ctx('SELECT * FROM c /* JOIN x IN c.hidden */ JOIN s IN c.sizes');
            expect(result.joinAliases).toHaveLength(1);
            expect(result.joinAliases[0].alias).toBe('s');
        });

        it('scopes aliases to their query block', () => {
            const text = 'SELECT s.label FROM c JOIN s IN c.sizes; SELECT v.color FROM c JOIN v IN c.sizes';
            const block1 = getCursorContext(text, 5);
            expect(block1.joinAliases).toHaveLength(1);
            expect(block1.joinAliases[0].alias).toBe('s');

            const block2 = getCursorContext(text, 45);
            expect(block2.joinAliases).toHaveLength(1);
            expect(block2.joinAliases[0].alias).toBe('v');
        });
    });

    // ─── Function Argument Context ──────────────────────────────────────────

    describe('insideFunction', () => {
        it('detects first argument of CONTAINS', () => {
            const result = ctx('SELECT * FROM c WHERE CONTAINS(');
            expect(result.insideFunction).toEqual({ name: 'CONTAINS', argIndex: 0 });
        });

        it('detects second argument of CONTAINS', () => {
            const result = ctx('SELECT * FROM c WHERE CONTAINS(c.name, ');
            expect(result.insideFunction).toEqual({ name: 'CONTAINS', argIndex: 1 });
        });

        it('detects third argument of CONTAINS', () => {
            const result = ctx("SELECT * FROM c WHERE CONTAINS(c.name, 'test', ");
            expect(result.insideFunction).toEqual({ name: 'CONTAINS', argIndex: 2 });
        });

        it('handles nested function calls — detects innermost function', () => {
            const result = ctx('SELECT * FROM c WHERE LOWER(SUBSTRING(');
            expect(result.insideFunction).toEqual({ name: 'SUBSTRING', argIndex: 0 });
        });

        it('handles nested function with args in outer', () => {
            const result = ctx('SELECT * FROM c WHERE CONTAINS(LOWER(c.name), ');
            expect(result.insideFunction).toEqual({ name: 'CONTAINS', argIndex: 1 });
        });

        it('returns null when not inside a function call', () => {
            expect(ctx('SELECT * FROM c WHERE ').insideFunction).toBeNull();
        });

        it('returns null when inside parentheses but not a function', () => {
            expect(ctx('SELECT * FROM c WHERE c.id IN (').insideFunction).toBeNull();
        });

        it('returns null after a closed function call', () => {
            expect(ctx('SELECT * FROM c WHERE CONTAINS(c.name, "test") AND ').insideFunction).toBeNull();
        });

        it('detects AVG function', () => {
            const result = ctx('SELECT AVG(');
            expect(result.insideFunction).toEqual({ name: 'AVG', argIndex: 0 });
        });

        it('handles case insensitivity for function name matching', () => {
            const result = ctx('SELECT * FROM c WHERE contains(');
            expect(result.insideFunction).toEqual({ name: 'CONTAINS', argIndex: 0 });
        });

        it('handles deeply nested functions', () => {
            const result = ctx('SELECT * FROM c WHERE CONTAINS(LOWER(TRIM(');
            expect(result.insideFunction).toEqual({ name: 'TRIM', argIndex: 0 });
        });
    });

    // ─── Graceful Incomplete Query Handling ──────────────────────────────────

    describe('incomplete queries', () => {
        it('empty document → clause is none, alias defaults to c', () => {
            const result = getCursorContext('', 0);
            expect(result.clause).toBe('none');
            expect(result.fromAlias).toBe('c');
        });

        it('typing SELECT → clause is select, initial position', () => {
            const result = ctx('SELECT ');
            expect(result.clause).toBe('select');
            expect(result.subPosition).toBe('initial');
        });

        it('SELECT * FROM c WHERE c. → still in WHERE clause', () => {
            const result = ctx('SELECT * FROM c WHERE c.');
            expect(result.clause).toBe('where');
        });

        it('multi-query with cursor in second query: aliases are isolated', () => {
            const text = 'SELECT * FROM products p WHERE p.price > 100; SELECT * FROM orders o WHERE o.total > ';
            const result = getCursorContext(text, text.length);
            expect(result.fromAlias).toBe('o');
        });

        it('handles SELECT FROM (missing select expressions)', () => {
            const result = ctx('SELECT FROM ');
            expect(result.clause).toBe('from');
            expect(result.subPosition).toBe('initial');
        });

        it('handles SELECT WHERE (missing FROM clause)', () => {
            const result = ctx('SELECT WHERE ');
            expect(result.clause).toBe('where');
            expect(result.subPosition).toBe('initial');
        });

        it('handles ORDER BY without preceding query', () => {
            const result = ctx('ORDER BY ');
            expect(result.clause).toBe('orderby');
            expect(result.subPosition).toBe('initial');
        });

        it('handles unclosed function call', () => {
            const result = ctx('SELECT * FROM c WHERE CONTAINS(c.name');
            expect(result.clause).toBe('where');
        });

        it('handles unclosed string before cursor', () => {
            const result = ctx("SELECT * FROM c WHERE c.name = 'unclosed ");
            expect(result.clause).toBe('where');
        });

        it('cursor right after semicolon starts fresh query context', () => {
            const text = 'SELECT * FROM c WHERE c.age > 10;';
            const result = getCursorContext(text, text.length);
            expect(result.clause).toBe('none');
            expect(result.fromAlias).toBe('c');
        });

        it('multiple semicolons produce empty blocks without errors', () => {
            const text = ';;;';
            for (let i = 0; i <= 3; i++) {
                const result = getCursorContext(text, i);
                expect(result.clause).toBe('none');
            }
        });

        it('handles whitespace-only text', () => {
            const result = ctx('   \n\t  ');
            expect(result.clause).toBe('none');
        });

        it('unclosed block comment does not crash parsing', () => {
            const text = 'SELECT * FROM c /* unclosed comment WHERE ';
            const result = ctx(text);
            // WHERE is inside the unclosed block comment, so clause should be FROM
            expect(result.clause).toBe('from');
        });
    });

    // ─── Multiline queries ──────────────────────────────────────────────────

    describe('multiline queries', () => {
        it('preserves correct clause detection across multiple lines', () => {
            const text = `SELECT
    c.name,
    c.age
FROM
    c
WHERE
    c.age > 10
ORDER BY
    c.name `;
            const result = ctx(text);
            expect(result.clause).toBe('orderby');
            expect(result.subPosition).toBe('post-expression');
        });
    });

    // ─── insideParenDepth ───────────────────────────────────────────────────

    describe('insideParenDepth', () => {
        it('is 0 at top level', () => {
            expect(ctx('SELECT * FROM c WHERE ').insideParenDepth).toBe(0);
        });

        it('is 1 inside a single open paren', () => {
            expect(ctx('SELECT * FROM c WHERE (').insideParenDepth).toBe(1);
        });

        it('is 2 with nested parens', () => {
            expect(ctx('SELECT * FROM c WHERE ((').insideParenDepth).toBe(2);
        });

        it('returns to 0 after matched parens', () => {
            expect(ctx('SELECT * FROM c WHERE (c.age > 10) AND ').insideParenDepth).toBe(0);
        });
    });
});
