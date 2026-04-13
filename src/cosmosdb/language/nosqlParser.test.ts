/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '../../utils/json/JSONSchema';
import { NOSQL_KEYWORDS, type KeywordInfo } from './nosqlLanguageDefinitions';
import {
    computeAliasSortKey,
    computeFunctionSortKey,
    computeKeywordSortKey,
    computePropertySortKey,
    computeTypeMatchScore,
    detectClauseContext,
    detectFunctionArgContext,
    extractFromAlias,
    extractJoinAliases,
    getCurrentQueryBlock,
    getExpectedArgType,
    isKeywordRelevant,
    resolveJoinAliasSchema,
    resolvePropertyAtPath,
    resolveSchemaProperties,
    TYPE_MATCH_EXACT,
    TYPE_MATCH_NONE,
    TYPE_MATCH_PARTIAL,
} from './nosqlParser';

describe('Phase 2: Multi-Query Isolation', () => {
    describe('getCurrentQueryBlock', () => {
        it('returns the full text when there are no semicolons', () => {
            const text = 'SELECT * FROM c WHERE c.age > 10';
            expect(getCurrentQueryBlock(text, 15)).toBe(text);
        });

        it('returns the first query block when cursor is in the first block', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            expect(getCurrentQueryBlock(text, 5)).toBe('SELECT * FROM c');
        });

        it('returns the second query block when cursor is in the second block', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            //                              ^ offset 17
            expect(getCurrentQueryBlock(text, 17)).toBe(' SELECT * FROM d');
        });

        it('handles cursor at the very start of the document', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            expect(getCurrentQueryBlock(text, 0)).toBe('SELECT * FROM c');
        });

        it('handles cursor at the very end of the document', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            expect(getCurrentQueryBlock(text, text.length)).toBe(' SELECT * FROM d');
        });

        it('handles cursor right after the semicolon (in the next block)', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            //                            ^ offset 16 is the space after ';'
            expect(getCurrentQueryBlock(text, 16)).toBe(' SELECT * FROM d');
        });

        it('handles cursor on the semicolon itself (boundary belongs to first block end)', () => {
            const text = 'SELECT * FROM c; SELECT * FROM d';
            //                           ^ offset 15 is the ';'
            expect(getCurrentQueryBlock(text, 15)).toBe('SELECT * FROM c');
        });

        it('handles multiple consecutive semicolons', () => {
            const text = 'SELECT 1;; SELECT 2';
            // S(0)E(1)L(2)E(3)C(4)T(5) (6)1(7);(8);(9)
            // offset 8 is first ';', offset 9 is second ';'
            // cursor at offset 8 → first block
            expect(getCurrentQueryBlock(text, 8)).toBe('SELECT 1');
            // cursor at offset 9 → the empty block between ;;
            expect(getCurrentQueryBlock(text, 9)).toBe('');
        });

        it('handles three query blocks', () => {
            const text = 'SELECT * FROM a; SELECT * FROM b; SELECT * FROM c';
            // cursor in third block
            expect(getCurrentQueryBlock(text, 35)).toBe(' SELECT * FROM c');
        });

        it('ignores semicolons inside single-quoted strings', () => {
            const text = "SELECT * FROM c WHERE c.name = 'hello;world'; SELECT * FROM d";
            // The ; inside the string should NOT be a boundary
            // cursor at offset 47 is in the second block
            expect(getCurrentQueryBlock(text, 47)).toBe(' SELECT * FROM d');
            // cursor at offset 30 is still in the first block
            expect(getCurrentQueryBlock(text, 30)).toBe("SELECT * FROM c WHERE c.name = 'hello;world'");
        });

        it('ignores semicolons inside double-quoted strings', () => {
            const text = 'SELECT * FROM c WHERE c.name = "hello;world"; SELECT * FROM d';
            expect(getCurrentQueryBlock(text, 47)).toBe(' SELECT * FROM d');
            expect(getCurrentQueryBlock(text, 30)).toBe('SELECT * FROM c WHERE c.name = "hello;world"');
        });

        it('ignores semicolons inside line comments', () => {
            const text = 'SELECT * FROM c -- this is a comment;\nWHERE c.age > 10; SELECT 1';
            // The ; in the comment should not be a boundary
            // First real boundary is at position of '; SELECT 1'
            expect(getCurrentQueryBlock(text, 5)).toContain('SELECT * FROM c');
            expect(getCurrentQueryBlock(text, 5)).toContain('WHERE c.age > 10');
        });

        it('ignores semicolons inside block comments', () => {
            const text = 'SELECT * FROM c /* comment with ; semicolon */ WHERE c.age > 10; SELECT 1';
            // cursor at offset 5 → first block
            expect(getCurrentQueryBlock(text, 5)).toContain('SELECT * FROM c');
            expect(getCurrentQueryBlock(text, 5)).toContain('WHERE c.age > 10');
        });

        it('handles SQL-style escaped single quotes', () => {
            const text = "SELECT * FROM c WHERE c.name = 'it''s;here'; SELECT 1";
            expect(getCurrentQueryBlock(text, 46)).toBe(' SELECT 1');
        });

        it('handles empty text', () => {
            expect(getCurrentQueryBlock('', 0)).toBe('');
        });

        it('handles text with only a semicolon', () => {
            expect(getCurrentQueryBlock(';', 0)).toBe('');
            expect(getCurrentQueryBlock(';', 1)).toBe('');
        });

        it('handles no semicolons in document', () => {
            const text = 'SELECT * FROM c\nWHERE c.active = true';
            expect(getCurrentQueryBlock(text, 20)).toBe(text);
        });
    });
});

describe('Phase 3a: Clause Context Detection', () => {
    describe('detectClauseContext', () => {
        // Helper: cursor at end of text
        const detect = (text: string) => detectClauseContext(text, text.length);

        it('returns "none" for empty text', () => {
            expect(detect('')).toMatchObject({ clause: 'none', subPosition: 'initial' });
        });

        it('returns "none" before any clause keyword', () => {
            expect(detect('  ')).toMatchObject({ clause: 'none' });
        });

        // ── SELECT ──────────────────────────────────────────────────────
        it('detects SELECT clause (initial)', () => {
            expect(detect('SELECT ')).toMatchObject({ clause: 'select', subPosition: 'initial' });
        });

        it('detects SELECT clause (post-star)', () => {
            expect(detect('SELECT * ')).toMatchObject({ clause: 'select', subPosition: 'post-star' });
        });

        it('detects SELECT clause (post-expression)', () => {
            expect(detect('SELECT c.name, ')).toMatchObject({ clause: 'select', subPosition: 'post-expression' });
        });

        // ── FROM ────────────────────────────────────────────────────────
        it('detects FROM clause (initial)', () => {
            expect(detect('SELECT * FROM ')).toMatchObject({ clause: 'from', subPosition: 'initial' });
        });

        it('detects FROM clause (post-alias)', () => {
            expect(detect('SELECT * FROM c ')).toMatchObject({ clause: 'from', subPosition: 'post-alias' });
        });

        // ── WHERE ───────────────────────────────────────────────────────
        it('detects WHERE clause (initial)', () => {
            expect(detect('SELECT * FROM c WHERE ')).toMatchObject({ clause: 'where', subPosition: 'initial' });
        });

        it('detects WHERE clause (post-expression)', () => {
            expect(detect('SELECT * FROM c WHERE c.age > ')).toMatchObject({
                clause: 'where',
                subPosition: 'post-expression',
            });
        });

        // ── ORDER BY ────────────────────────────────────────────────────
        it('detects ORDER BY clause (initial)', () => {
            expect(detect('SELECT * FROM c ORDER BY ')).toMatchObject({
                clause: 'orderby',
                subPosition: 'initial',
            });
        });

        it('detects ORDER BY clause (post-expression)', () => {
            expect(detect('SELECT * FROM c ORDER BY c.name ')).toMatchObject({
                clause: 'orderby',
                subPosition: 'post-expression',
            });
        });

        it('detects ORDER BY RANK', () => {
            expect(detect('SELECT * FROM c ORDER BY RANK ')).toMatchObject({
                clause: 'orderby',
                subPosition: 'initial',
            });
        });

        // ── GROUP BY ────────────────────────────────────────────────────
        it('detects GROUP BY clause (initial)', () => {
            expect(detect('SELECT * FROM c GROUP BY ')).toMatchObject({
                clause: 'groupby',
                subPosition: 'initial',
            });
        });

        it('detects GROUP BY clause (post-expression)', () => {
            expect(detect('SELECT * FROM c GROUP BY c.type ')).toMatchObject({
                clause: 'groupby',
                subPosition: 'post-expression',
            });
        });

        // ── JOIN ────────────────────────────────────────────────────────
        it('detects JOIN clause', () => {
            expect(detect('SELECT * FROM c JOIN ')).toMatchObject({ clause: 'join', subPosition: 'initial' });
        });

        // ── OFFSET / LIMIT ──────────────────────────────────────────────
        it('detects OFFSET clause', () => {
            expect(detect('SELECT * FROM c OFFSET ')).toMatchObject({ clause: 'offset', subPosition: 'initial' });
        });

        it('detects LIMIT clause', () => {
            expect(detect('SELECT * FROM c OFFSET 10 LIMIT ')).toMatchObject({
                clause: 'limit',
                subPosition: 'initial',
            });
        });

        // ── hasGroupBy ──────────────────────────────────────────────────
        it('detects hasGroupBy when GROUP BY is in the query', () => {
            const text = 'SELECT c.type, COUNT(1) FROM c GROUP BY c.type';
            // cursor at end of SELECT (offset 7)
            const ctx = detectClauseContext(text, 7);
            expect(ctx.hasGroupBy).toBe(true);
        });

        it('hasGroupBy is false when no GROUP BY', () => {
            expect(detect('SELECT * FROM c WHERE c.age > 10')).toMatchObject({ hasGroupBy: false });
        });

        // ── Nested parentheses ──────────────────────────────────────────
        it('does not confuse SELECT inside function parentheses', () => {
            // Cursor after CONTAINS( — the WHERE clause is still the context
            expect(detect('SELECT * FROM c WHERE CONTAINS(')).toMatchObject({ clause: 'where' });
        });

        it('handles nested function calls', () => {
            expect(detect('SELECT * FROM c WHERE LOWER(CONTAINS(')).toMatchObject({ clause: 'where' });
        });

        // ── Keywords in strings ─────────────────────────────────────────
        it('ignores clause keywords inside string literals', () => {
            expect(detect("SELECT * FROM c WHERE c.name = 'SELECT FROM WHERE' AND ")).toMatchObject({
                clause: 'where',
            });
        });

        // ── Keywords in comments ────────────────────────────────────────
        it('ignores clause keywords inside line comments', () => {
            expect(detect('SELECT * FROM c -- WHERE clause\nWHERE ')).toMatchObject({
                clause: 'where',
                subPosition: 'initial',
            });
        });

        it('ignores clause keywords inside block comments', () => {
            expect(detect('SELECT * FROM c /* WHERE */ ORDER BY ')).toMatchObject({
                clause: 'orderby',
                subPosition: 'initial',
            });
        });

        // ── Partial queries ─────────────────────────────────────────────
        it('works with just SELECT (no FROM yet)', () => {
            expect(detect('SELECT ')).toMatchObject({ clause: 'select', subPosition: 'initial' });
        });

        it('works with just SELECT * (no FROM yet)', () => {
            expect(detect('SELECT * ')).toMatchObject({ clause: 'select', subPosition: 'post-star' });
        });

        // ── precedingToken ──────────────────────────────────────────────
        it('returns the preceding token', () => {
            expect(detect('SELECT * FROM c WHERE c.age > ').precedingToken).toBe('>');
        });

        it('returns keyword as preceding token', () => {
            expect(detect('SELECT * FROM c WHERE ').precedingToken).toBe('where');
        });

        it('returns null preceding token for empty text', () => {
            expect(detect('').precedingToken).toBeNull();
        });
    });
});

// ─── Phase 3b: Clause-Aware Suggestion Filtering ──────────────────────────────

describe('Phase 3b: Clause-Aware Suggestion Filtering', () => {
    // Helper to find a keyword by name
    const findKeyword = (name: string): KeywordInfo => {
        const kw = NOSQL_KEYWORDS.find((k) => k.name === name);
        if (!kw) throw new Error(`Keyword ${name} not found`);
        return kw;
    };

    describe('isKeywordRelevant', () => {
        it('SELECT is relevant after none (start of query)', () => {
            const ctx = detectClauseContext('', 0);
            expect(isKeywordRelevant(findKeyword('SELECT'), ctx)).toBe(true);
        });

        it('SELECT is NOT relevant after WHERE', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE ', 22);
            expect(isKeywordRelevant(findKeyword('SELECT'), ctx)).toBe(false);
        });

        it('FROM is relevant after SELECT', () => {
            const ctx = detectClauseContext('SELECT * ', 9);
            expect(isKeywordRelevant(findKeyword('FROM'), ctx)).toBe(true);
        });

        it('WHERE is relevant after FROM', () => {
            const ctx = detectClauseContext('SELECT * FROM c ', 16);
            expect(isKeywordRelevant(findKeyword('WHERE'), ctx)).toBe(true);
        });

        it('WHERE is relevant after JOIN', () => {
            const ctx = detectClauseContext('SELECT * FROM c JOIN s IN c.sizes ', 34);
            expect(isKeywordRelevant(findKeyword('WHERE'), ctx)).toBe(true);
        });

        it('ORDER BY is relevant after WHERE', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE c.age > 10 ', 33);
            expect(isKeywordRelevant(findKeyword('ORDER BY'), ctx)).toBe(true);
        });

        it('ASC is relevant after ORDER BY', () => {
            const ctx = detectClauseContext('SELECT * FROM c ORDER BY c.name ', 32);
            expect(isKeywordRelevant(findKeyword('ASC'), ctx)).toBe(true);
        });

        it('ASC is NOT relevant after WHERE', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE ', 22);
            expect(isKeywordRelevant(findKeyword('ASC'), ctx)).toBe(false);
        });

        it('AND is relevant after WHERE', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE c.age > 10 ', 33);
            expect(isKeywordRelevant(findKeyword('AND'), ctx)).toBe(true);
        });

        it('AND is NOT relevant after SELECT', () => {
            const ctx = detectClauseContext('SELECT ', 7);
            expect(isKeywordRelevant(findKeyword('AND'), ctx)).toBe(false);
        });

        it('TRUE is relevant in WHERE clause', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE ', 22);
            expect(isKeywordRelevant(findKeyword('TRUE'), ctx)).toBe(true);
        });

        it('DISTINCT is relevant after SELECT', () => {
            const ctx = detectClauseContext('SELECT ', 7);
            expect(isKeywordRelevant(findKeyword('DISTINCT'), ctx)).toBe(true);
        });

        it('JOIN is relevant after FROM', () => {
            const ctx = detectClauseContext('SELECT * FROM c ', 16);
            expect(isKeywordRelevant(findKeyword('JOIN'), ctx)).toBe(true);
        });

        it('LIMIT is relevant after OFFSET', () => {
            const ctx = detectClauseContext('SELECT * FROM c OFFSET 10 ', 26);
            expect(isKeywordRelevant(findKeyword('LIMIT'), ctx)).toBe(true);
        });

        it('LIMIT is NOT relevant after SELECT', () => {
            const ctx = detectClauseContext('SELECT ', 7);
            expect(isKeywordRelevant(findKeyword('LIMIT'), ctx)).toBe(false);
        });
    });

    describe('computeKeywordSortKey', () => {
        it('returns prefix 1_ for relevant keywords', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE ', 22);
            expect(computeKeywordSortKey(findKeyword('AND'), ctx)).toBe('1_AND');
        });

        it('returns prefix 5_ for non-relevant keywords', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE ', 22);
            expect(computeKeywordSortKey(findKeyword('SELECT'), ctx)).toBe('5_SELECT');
        });
    });

    describe('computeFunctionSortKey', () => {
        it('returns prefix 2_ for functions in expression clauses', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE ', 22);
            expect(computeFunctionSortKey('CONTAINS', ctx)).toMatch(/^2_/);
        });

        it('returns prefix 6_ for functions in non-expression clauses', () => {
            const ctx = detectClauseContext('SELECT * FROM ', 14);
            expect(computeFunctionSortKey('CONTAINS', ctx)).toMatch(/^6_/);
        });

        it('boosts aggregate functions in SELECT when GROUP BY exists', () => {
            const text = 'SELECT  FROM c GROUP BY c.type';
            // Cursor at SELECT offset 7 (inside SELECT clause)
            const ctx = detectClauseContext(text, 7);
            expect(ctx.hasGroupBy).toBe(true);
            expect(ctx.clause).toBe('select');
            expect(computeFunctionSortKey('COUNT', ctx)).toMatch(/^1_/);
            expect(computeFunctionSortKey('AVG', ctx)).toMatch(/^1_/);
        });

        it('does NOT boost aggregate functions in SELECT without GROUP BY', () => {
            const ctx = detectClauseContext('SELECT ', 7);
            expect(ctx.hasGroupBy).toBe(false);
            expect(computeFunctionSortKey('COUNT', ctx)).toMatch(/^2_/);
        });

        it('does NOT boost non-aggregate functions even with GROUP BY', () => {
            const text = 'SELECT  FROM c GROUP BY c.type';
            const ctx = detectClauseContext(text, 7);
            expect(computeFunctionSortKey('CONTAINS', ctx)).toMatch(/^2_/);
        });
    });

    describe('computeAliasSortKey', () => {
        it('returns prefix 0_ for aliases in WHERE', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE ', 22);
            expect(computeAliasSortKey('c', ctx)).toBe('0_c');
        });

        it('returns prefix 0_ for aliases in SELECT', () => {
            const ctx = detectClauseContext('SELECT ', 7);
            expect(computeAliasSortKey('c', ctx)).toBe('0_c');
        });

        it('returns prefix 0_ for aliases in ORDER BY', () => {
            const ctx = detectClauseContext('SELECT * FROM c ORDER BY ', 25);
            expect(computeAliasSortKey('c', ctx)).toBe('0_c');
        });

        it('returns prefix 4_ for aliases in FROM (less relevant)', () => {
            const ctx = detectClauseContext('SELECT * FROM ', 14);
            expect(computeAliasSortKey('c', ctx)).toBe('4_c');
        });

        it('returns prefix 4_ for aliases at start (none clause)', () => {
            const ctx = detectClauseContext('', 0);
            expect(computeAliasSortKey('c', ctx)).toBe('4_c');
        });
    });

    describe('sort order integration', () => {
        it('in WHERE: aliases sort before relevant keywords, before functions, before irrelevant keywords', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE ', 22);
            const aliasSortKey = computeAliasSortKey('c', ctx);
            const andSortKey = computeKeywordSortKey(findKeyword('AND'), ctx);
            const containsSortKey = computeFunctionSortKey('CONTAINS', ctx);
            const selectSortKey = computeKeywordSortKey(findKeyword('SELECT'), ctx);

            // Lexicographic: 0_c < 1_AND < 2_CONTAINS < 5_SELECT
            expect(aliasSortKey < andSortKey).toBe(true);
            expect(andSortKey < containsSortKey).toBe(true);
            expect(containsSortKey < selectSortKey).toBe(true);
        });

        it('in ORDER BY post-expression: ASC/DESC would be boosted with 00_ prefix', () => {
            // This tests the expected behavior when providers apply the 00_ prefix
            const ctx = detectClauseContext('SELECT * FROM c ORDER BY c.name ', 32);
            expect(ctx.clause).toBe('orderby');
            expect(ctx.subPosition).toBe('post-expression');
            // The providers will set sortText = '00_ASC' for this case
            expect(isKeywordRelevant(findKeyword('ASC'), ctx)).toBe(true);
            expect(isKeywordRelevant(findKeyword('DESC'), ctx)).toBe(true);
        });

        it('in SELECT initial: TOP/DISTINCT/VALUE are relevant', () => {
            const ctx = detectClauseContext('SELECT ', 7);
            expect(ctx.clause).toBe('select');
            expect(ctx.subPosition).toBe('initial');
            expect(isKeywordRelevant(findKeyword('TOP'), ctx)).toBe(true);
            expect(isKeywordRelevant(findKeyword('DISTINCT'), ctx)).toBe(true);
            expect(isKeywordRelevant(findKeyword('VALUE'), ctx)).toBe(true);
        });
    });
});

// ─── Phase 4: Function Argument Context & Type-Ranked Properties ──────────────

describe('Phase 4: Function Argument Context & Type-Ranked Properties', () => {
    describe('detectFunctionArgContext', () => {
        it('detects first argument of CONTAINS', () => {
            const text = 'SELECT * FROM c WHERE CONTAINS(';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'CONTAINS', argIndex: 0 });
        });

        it('detects second argument of CONTAINS', () => {
            const text = 'SELECT * FROM c WHERE CONTAINS(c.name, ';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'CONTAINS', argIndex: 1 });
        });

        it('detects third argument of CONTAINS', () => {
            const text = "SELECT * FROM c WHERE CONTAINS(c.name, 'test', ";
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'CONTAINS', argIndex: 2 });
        });

        it('handles nested function calls — detects innermost function', () => {
            const text = 'SELECT * FROM c WHERE LOWER(SUBSTRING(';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'SUBSTRING', argIndex: 0 });
        });

        it('handles nested function with args in outer', () => {
            const text = 'SELECT * FROM c WHERE CONTAINS(LOWER(c.name), ';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'CONTAINS', argIndex: 1 });
        });

        it('returns null when not inside a function call', () => {
            const text = 'SELECT * FROM c WHERE ';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toBeNull();
        });

        it('returns null when inside parentheses but not a function (e.g., subquery)', () => {
            const text = 'SELECT * FROM c WHERE c.id IN (';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toBeNull();
        });

        it('returns null after a closed function call', () => {
            const text = 'SELECT * FROM c WHERE CONTAINS(c.name, "test") AND ';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toBeNull();
        });

        it('detects function context with cursor mid-text', () => {
            const text = 'SELECT * FROM c WHERE CONTAINS(c.name, "test")';
            // cursor at offset 31 (right after the opening paren)
            const result = detectFunctionArgContext(text, 31);
            expect(result).toEqual({ functionName: 'CONTAINS', argIndex: 0 });
        });

        it('handles case insensitivity for function name matching', () => {
            const text = 'SELECT * FROM c WHERE contains(';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'CONTAINS', argIndex: 0 });
        });

        it('detects AVG function', () => {
            const text = 'SELECT AVG(';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'AVG', argIndex: 0 });
        });

        it('handles string literals containing commas/parens correctly', () => {
            const text = "SELECT * FROM c WHERE CONTAINS(c.name, 'he(l,lo', ";
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'CONTAINS', argIndex: 2 });
        });

        it('handles deeply nested functions', () => {
            const text = 'SELECT * FROM c WHERE CONTAINS(LOWER(TRIM(';
            const result = detectFunctionArgContext(text, text.length);
            expect(result).toEqual({ functionName: 'TRIM', argIndex: 0 });
        });
    });

    describe('getExpectedArgType', () => {
        it('returns string for first arg of CONTAINS', () => {
            expect(getExpectedArgType('CONTAINS', 0)).toBe('string');
        });

        it('returns string for second arg of CONTAINS', () => {
            expect(getExpectedArgType('CONTAINS', 1)).toBe('string');
        });

        it('returns boolean for third arg of CONTAINS', () => {
            expect(getExpectedArgType('CONTAINS', 2)).toBe('boolean');
        });

        it('returns any for first arg of AVG', () => {
            expect(getExpectedArgType('AVG', 0)).toBe('any');
        });

        it('returns null for unknown function', () => {
            expect(getExpectedArgType('UNKNOWN_FUNC', 0)).toBeNull();
        });

        it('returns null for out-of-range arg index', () => {
            expect(getExpectedArgType('CONTAINS', 10)).toBeNull();
        });

        it('is case-insensitive', () => {
            expect(getExpectedArgType('contains', 0)).toBe('string');
        });
    });

    describe('computeTypeMatchScore', () => {
        it('returns EXACT for matching simple type', () => {
            expect(computeTypeMatchScore({ type: 'string' }, 'string')).toBe(TYPE_MATCH_EXACT);
        });

        it('returns EXACT for "any" expected type', () => {
            expect(computeTypeMatchScore({ type: 'number' }, 'any')).toBe(TYPE_MATCH_EXACT);
        });

        it('returns NONE for non-matching simple type', () => {
            expect(computeTypeMatchScore({ type: 'number' }, 'string')).toBe(TYPE_MATCH_NONE);
        });

        it('returns PARTIAL for anyOf with one matching type', () => {
            const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] };
            expect(computeTypeMatchScore(schema, 'string')).toBe(TYPE_MATCH_PARTIAL);
        });

        it('returns NONE for anyOf with no matching type', () => {
            const schema = { anyOf: [{ type: 'number' }, { type: 'boolean' }] };
            expect(computeTypeMatchScore(schema, 'string')).toBe(TYPE_MATCH_NONE);
        });

        it('returns EXACT for array type when array is expected', () => {
            expect(computeTypeMatchScore({ type: 'array' }, 'array')).toBe(TYPE_MATCH_EXACT);
        });

        it('returns NONE for schema with no type info', () => {
            expect(computeTypeMatchScore({}, 'string')).toBe(TYPE_MATCH_NONE);
        });
    });

    describe('computePropertySortKey', () => {
        it('returns occurrence-only key when no expected type', () => {
            const schema = { type: 'string', 'x-occurrence': 500 };
            const key = computePropertySortKey(schema, null);
            // 1e9 - 500 = 999999500, padded to 10 digits
            expect(key).toBe('0999999500');
        });

        it('prefixes with type score when expected type is provided', () => {
            const stringProp = { type: 'string', 'x-occurrence': 500 };
            const numberProp = { type: 'number', 'x-occurrence': 800 };

            const stringKey = computePropertySortKey(stringProp, 'string');
            const numberKey = computePropertySortKey(numberProp, 'string');

            // string matches → prefix 0_, number doesn't → prefix 2_
            expect(stringKey).toMatch(/^0_/);
            expect(numberKey).toMatch(/^2_/);
            // Exact match ranks higher (sorts first) despite lower occurrence
            expect(stringKey < numberKey).toBe(true);
        });

        it('ranks exact match above partial match above no match', () => {
            const exactProp = { type: 'string', 'x-occurrence': 100 };
            const partialProp = { anyOf: [{ type: 'string' }, { type: 'number' }], 'x-occurrence': 100 };
            const noMatchProp = { type: 'number', 'x-occurrence': 100 };

            const exactKey = computePropertySortKey(exactProp, 'string');
            const partialKey = computePropertySortKey(partialProp, 'string');
            const noMatchKey = computePropertySortKey(noMatchProp, 'string');

            expect(exactKey < partialKey).toBe(true);
            expect(partialKey < noMatchKey).toBe(true);
        });

        it('within same type tier, higher occurrence ranks first', () => {
            const high = { type: 'string', 'x-occurrence': 900 };
            const low = { type: 'string', 'x-occurrence': 100 };

            const highKey = computePropertySortKey(high, 'string');
            const lowKey = computePropertySortKey(low, 'string');

            expect(highKey < lowKey).toBe(true);
        });
    });
});

// ─── Phase 5: Graceful Incomplete Query Handling ──────────────

describe('Phase 5: Graceful Incomplete Query Handling', () => {
    describe('Empty and minimal documents', () => {
        it('getCurrentQueryBlock handles empty string', () => {
            expect(getCurrentQueryBlock('', 0)).toBe('');
        });

        it('detectClauseContext handles empty string', () => {
            const ctx = detectClauseContext('', 0);
            expect(ctx.clause).toBe('none');
            expect(ctx.subPosition).toBe('initial');
            expect(ctx.hasGroupBy).toBe(false);
            expect(ctx.precedingToken).toBeNull();
        });

        it('detectFunctionArgContext handles empty string', () => {
            expect(detectFunctionArgContext('', 0)).toBeNull();
        });

        it('extractFromAlias returns default "c" for empty text', () => {
            expect(extractFromAlias('')).toBe('c');
        });

        it('extractJoinAliases returns empty array for empty text', () => {
            expect(extractJoinAliases('')).toEqual([]);
        });

        it('detectClauseContext handles whitespace-only text', () => {
            const ctx = detectClauseContext('   \n\t  ', 5);
            expect(ctx.clause).toBe('none');
        });
    });

    describe('Queries with no FROM clause', () => {
        it('detectClauseContext works with SELECT only', () => {
            const ctx = detectClauseContext('SELECT ', 7);
            expect(ctx.clause).toBe('select');
            expect(ctx.subPosition).toBe('initial');
        });

        it('extractFromAlias falls back to "c" when no FROM', () => {
            expect(extractFromAlias('SELECT *')).toBe('c');
        });

        it('extractJoinAliases returns empty when no JOIN', () => {
            expect(extractJoinAliases('SELECT * FROM c WHERE c.age > 10')).toEqual([]);
        });

        it('detectClauseContext works with SELECT * (no FROM)', () => {
            const ctx = detectClauseContext('SELECT * ', 9);
            expect(ctx.clause).toBe('select');
            expect(ctx.subPosition).toBe('post-star');
        });
    });

    describe('Dangling keywords', () => {
        it('handles SELECT FROM (missing select expressions)', () => {
            const ctx = detectClauseContext('SELECT FROM ', 12);
            expect(ctx.clause).toBe('from');
            expect(ctx.subPosition).toBe('initial');
        });

        it('handles SELECT WHERE (missing FROM clause)', () => {
            const ctx = detectClauseContext('SELECT WHERE ', 13);
            expect(ctx.clause).toBe('where');
            expect(ctx.subPosition).toBe('initial');
        });

        it('handles FROM WHERE (missing SELECT clause)', () => {
            const ctx = detectClauseContext('FROM c WHERE ', 13);
            expect(ctx.clause).toBe('where');
            expect(ctx.subPosition).toBe('initial');
        });

        it('handles ORDER BY without preceding query', () => {
            const ctx = detectClauseContext('ORDER BY ', 9);
            expect(ctx.clause).toBe('orderby');
            expect(ctx.subPosition).toBe('initial');
        });

        it('handles GROUP BY without preceding query', () => {
            const ctx = detectClauseContext('GROUP BY ', 9);
            expect(ctx.clause).toBe('groupby');
            expect(ctx.subPosition).toBe('initial');
        });
    });

    describe('Unclosed parentheses', () => {
        it('detectClauseContext handles unclosed function call', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE CONTAINS(c.name', 37);
            expect(ctx.clause).toBe('where');
        });

        it('detectFunctionArgContext handles unclosed nested parens', () => {
            const text = 'SELECT * FROM c WHERE CONTAINS(LOWER(c.name';
            const result = detectFunctionArgContext(text, text.length);
            // Cursor is inside LOWER's first arg
            expect(result).toEqual({ functionName: 'LOWER', argIndex: 0 });
        });

        it('detectClauseContext handles multiple unclosed parens', () => {
            const ctx = detectClauseContext('SELECT * FROM c WHERE (c.age > 10 AND (c.name = ', 49);
            expect(ctx.clause).toBe('where');
        });

        it('clause detection ignores keywords inside unclosed parens', () => {
            // A SELECT inside parens should not be detected as the clause keyword
            const ctx = detectClauseContext('SELECT * FROM c WHERE (SELECT ', 30);
            // The top-level clause is WHERE, the SELECT inside parens is not at top level
            expect(ctx.clause).toBe('where');
        });
    });

    describe('Unclosed string literals', () => {
        it('getCurrentQueryBlock handles unclosed single-quoted string', () => {
            const text = "SELECT * FROM c WHERE c.name = 'hello; SELECT 1";
            // The semicolon is inside the unclosed string, so no boundary
            expect(getCurrentQueryBlock(text, 5)).toBe(text);
        });

        it('getCurrentQueryBlock handles unclosed double-quoted string', () => {
            const text = 'SELECT * FROM c WHERE c.name = "hello; SELECT 1';
            expect(getCurrentQueryBlock(text, 5)).toBe(text);
        });

        it('detectClauseContext handles unclosed string before cursor', () => {
            // Should not crash; the string stripping handles the unclosed string
            const text = "SELECT * FROM c WHERE c.name = 'unclosed ";
            const ctx = detectClauseContext(text, text.length);
            expect(ctx.clause).toBe('where');
        });
    });

    describe('Cursor at document boundaries', () => {
        it('cursor at offset 0 of a multi-query doc returns first block', () => {
            const text = 'SELECT 1; SELECT 2';
            expect(getCurrentQueryBlock(text, 0)).toBe('SELECT 1');
        });

        it('cursor at end of multi-query doc returns last block', () => {
            const text = 'SELECT 1; SELECT 2';
            expect(getCurrentQueryBlock(text, text.length)).toBe(' SELECT 2');
        });

        it('detectClauseContext at offset 0 returns none', () => {
            const ctx = detectClauseContext('SELECT * FROM c', 0);
            expect(ctx.clause).toBe('none');
        });
    });

    describe('Chained JOIN resolution', () => {
        // Schema simulating: container with documents having sizes[] array,
        // where each size has variants[] array
        const chainedSchema: JSONSchema = {
            type: 'object',
            properties: {
                name: { type: 'string', 'x-occurrence': 100 },
                sizes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string', 'x-occurrence': 90 },
                            variants: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        color: { type: 'string', 'x-occurrence': 80 },
                                        sku: { type: 'string', 'x-occurrence': 70 },
                                    } as unknown as JSONSchema,
                                },
                                'x-occurrence': 85,
                            },
                        } as unknown as JSONSchema,
                    },
                    'x-occurrence': 95,
                },
            } as unknown as JSONSchema,
        };

        it('extracts chained JOIN aliases from a single query block', () => {
            const query = 'SELECT v.color FROM c JOIN s IN c.sizes JOIN v IN s.variants WHERE v.sku = "ABC"';
            const joinAliases = extractJoinAliases(query);
            expect(joinAliases).toHaveLength(2);
            expect(joinAliases[0]).toEqual({ alias: 's', sourceAlias: 'c', propertyPath: ['sizes'] });
            expect(joinAliases[1]).toEqual({ alias: 'v', sourceAlias: 's', propertyPath: ['variants'] });
        });

        it('resolves first JOIN alias (s → c.sizes items)', () => {
            const query = 'SELECT * FROM c JOIN s IN c.sizes';
            const joinAliases = extractJoinAliases(query);
            const fromAlias = extractFromAlias(query);

            const schema = resolveJoinAliasSchema(chainedSchema, joinAliases[0], fromAlias, joinAliases);
            expect(schema).toBeDefined();
            expect(schema!.properties).toHaveProperty('label');
            expect(schema!.properties).toHaveProperty('variants');
        });

        it('resolves chained JOIN alias (v → s.variants → c.sizes[].variants items)', () => {
            const query = 'SELECT * FROM c JOIN s IN c.sizes JOIN v IN s.variants';
            const joinAliases = extractJoinAliases(query);
            const fromAlias = extractFromAlias(query);

            const schema = resolveJoinAliasSchema(chainedSchema, joinAliases[1], fromAlias, joinAliases);
            expect(schema).toBeDefined();
            expect(schema!.properties).toHaveProperty('color');
            expect(schema!.properties).toHaveProperty('sku');
        });

        it('resolvePropertyAtPath resolves v.color through chained JOINs', () => {
            const query = 'SELECT * FROM c JOIN s IN c.sizes JOIN v IN s.variants';
            const joinAliases = extractJoinAliases(query);
            const fromAlias = extractFromAlias(query);

            const result = resolvePropertyAtPath(chainedSchema, 'v.color', fromAlias, joinAliases);
            expect(result).toBeDefined();
            expect(result!.propertyName).toBe('color');
            expect(result!.propSchema.type).toBe('string');
        });

        it('resolvePropertyAtPath resolves s.label through single JOIN', () => {
            const query = 'SELECT * FROM c JOIN s IN c.sizes';
            const joinAliases = extractJoinAliases(query);
            const fromAlias = extractFromAlias(query);

            const result = resolvePropertyAtPath(chainedSchema, 's.label', fromAlias, joinAliases);
            expect(result).toBeDefined();
            expect(result!.propertyName).toBe('label');
        });

        it('resolveSchemaProperties returns undefined for non-existing path', () => {
            const result = resolveSchemaProperties(chainedSchema, ['nonexistent']);
            expect(result).toBeUndefined();
        });

        it('chained JOIN aliases are scoped to their query block', () => {
            const text = 'SELECT s.label FROM c JOIN s IN c.sizes; SELECT v.color FROM c JOIN v IN c.sizes';
            // In the first block, only 's' exists
            const block1 = getCurrentQueryBlock(text, 5);
            const aliases1 = extractJoinAliases(block1);
            expect(aliases1).toHaveLength(1);
            expect(aliases1[0].alias).toBe('s');

            // In the second block, only 'v' exists
            const block2 = getCurrentQueryBlock(text, 45);
            const aliases2 = extractJoinAliases(block2);
            expect(aliases2).toHaveLength(1);
            expect(aliases2[0].alias).toBe('v');
        });
    });

    describe('Integration: realistic partial query scenarios', () => {
        it('empty document → clause is none, alias defaults to c', () => {
            const text = '';
            const block = getCurrentQueryBlock(text, 0);
            const ctx = detectClauseContext(block, 0);
            const fromAlias = extractFromAlias(block);
            expect(ctx.clause).toBe('none');
            expect(fromAlias).toBe('c');
        });

        it('typing SELECT → clause is select, initial position', () => {
            const text = 'SELECT ';
            const block = getCurrentQueryBlock(text, text.length);
            const ctx = detectClauseContext(block, text.length);
            expect(ctx.clause).toBe('select');
            expect(ctx.subPosition).toBe('initial');
        });

        it('SELECT * FROM c WHERE c.| → still in WHERE clause', () => {
            const text = 'SELECT * FROM c WHERE c.';
            const block = getCurrentQueryBlock(text, text.length);
            const blockStart = text.lastIndexOf(block, text.length);
            const offsetInBlock = text.length - (blockStart >= 0 ? blockStart : 0);
            const ctx = detectClauseContext(block, offsetInBlock);
            expect(ctx.clause).toBe('where');
        });

        it('multi-query with cursor in second query: aliases are isolated', () => {
            const fullText = 'SELECT * FROM products p WHERE p.price > 100; SELECT * FROM orders o WHERE o.total > ';
            const cursorOffset = fullText.length;
            const block = getCurrentQueryBlock(fullText, cursorOffset);
            const fromAlias = extractFromAlias(block);
            expect(fromAlias).toBe('o');
        });

        it('typing inside a function call inside WHERE', () => {
            const text = 'SELECT * FROM c WHERE CONTAINS(c.name, ';
            const block = getCurrentQueryBlock(text, text.length);
            const funcCtx = detectFunctionArgContext(block, text.length);
            expect(funcCtx).toEqual({ functionName: 'CONTAINS', argIndex: 1 });

            const expectedType = getExpectedArgType(funcCtx!.functionName, funcCtx!.argIndex);
            expect(expectedType).toBe('string');
        });

        it('ORDER BY c.name then typing → post-expression for ASC/DESC', () => {
            const text = 'SELECT * FROM c ORDER BY c.name ';
            const block = getCurrentQueryBlock(text, text.length);
            const ctx = detectClauseContext(block, text.length);
            expect(ctx.clause).toBe('orderby');
            expect(ctx.subPosition).toBe('post-expression');
        });

        it('GROUP BY in query boosts aggregates in SELECT', () => {
            const text = 'SELECT  FROM c GROUP BY c.type';
            const block = getCurrentQueryBlock(text, 7);
            const ctx = detectClauseContext(block, 7);
            expect(ctx.clause).toBe('select');
            expect(ctx.hasGroupBy).toBe(true);
            expect(computeFunctionSortKey('COUNT', ctx)).toMatch(/^1_/);
            expect(computeFunctionSortKey('SUM', ctx)).toMatch(/^1_/);
        });

        it('unclosed block comment does not crash parsing', () => {
            const text = 'SELECT * FROM c /* unclosed comment WHERE ';
            const block = getCurrentQueryBlock(text, text.length);
            // Should not throw
            const ctx = detectClauseContext(block, block.length);
            // The WHERE is inside the block comment, so clause should be FROM
            expect(ctx.clause).toBe('from');
        });

        it('cursor right after semicolon starts fresh query context', () => {
            const text = 'SELECT * FROM c WHERE c.age > 10;';
            const cursorOffset = text.length; // right after ';'
            const block = getCurrentQueryBlock(text, cursorOffset);
            const ctx = detectClauseContext(block, block.length);
            expect(ctx.clause).toBe('none');
            expect(extractFromAlias(block)).toBe('c'); // default fallback
        });

        it('multiple semicolons produce empty blocks without errors', () => {
            const text = ';;;';
            expect(getCurrentQueryBlock(text, 0)).toBe('');
            expect(getCurrentQueryBlock(text, 1)).toBe('');
            expect(getCurrentQueryBlock(text, 2)).toBe('');
            expect(getCurrentQueryBlock(text, 3)).toBe('');

            // None of these should throw
            for (let i = 0; i <= 3; i++) {
                const block = getCurrentQueryBlock(text, i);
                const ctx = detectClauseContext(block, block.length);
                expect(ctx.clause).toBe('none');
            }
        });

        it('handles query with only whitespace and newlines', () => {
            const text = '  \n\n  \t  ';
            const block = getCurrentQueryBlock(text, 3);
            const ctx = detectClauseContext(block, 3);
            expect(ctx.clause).toBe('none');
        });

        it('multiline query preserves correct clause detection', () => {
            const text = `SELECT
    c.name,
    c.age
FROM
    c
WHERE
    c.age > 10
ORDER BY
    c.name `;
            const ctx = detectClauseContext(text, text.length);
            expect(ctx.clause).toBe('orderby');
            expect(ctx.subPosition).toBe('post-expression');
        });
    });

    describe('Comment ignoring across all parser functions', () => {
        describe('extractFromAlias ignores comments', () => {
            it('ignores FROM inside a line comment', () => {
                const text = '-- FROM fake\nSELECT * FROM c';
                expect(extractFromAlias(text)).toBe('c');
            });

            it('ignores FROM inside a block comment', () => {
                const text = '/* FROM fake */ SELECT * FROM c';
                expect(extractFromAlias(text)).toBe('c');
            });

            it('only picks the real FROM when a commented FROM comes first', () => {
                const text = '/* FROM wrong AS w */ SELECT * FROM container AS doc';
                expect(extractFromAlias(text)).toBe('doc');
            });

            it('ignores FROM alias inside a line comment at end of line', () => {
                const text = 'SELECT * FROM c -- FROM d\nWHERE c.age > 10';
                expect(extractFromAlias(text)).toBe('c');
            });
        });

        describe('extractJoinAliases ignores comments', () => {
            it('ignores JOIN inside a line comment', () => {
                const text = '-- JOIN fake IN c.items\nSELECT * FROM c JOIN s IN c.sizes';
                const aliases = extractJoinAliases(text);
                expect(aliases).toHaveLength(1);
                expect(aliases[0].alias).toBe('s');
            });

            it('ignores JOIN inside a block comment', () => {
                const text = '/* JOIN fake IN c.items */ SELECT * FROM c JOIN s IN c.sizes';
                const aliases = extractJoinAliases(text);
                expect(aliases).toHaveLength(1);
                expect(aliases[0].alias).toBe('s');
            });

            it('ignores JOIN inside a mid-query block comment', () => {
                const text = 'SELECT * FROM c /* JOIN x IN c.hidden */ JOIN s IN c.sizes';
                const aliases = extractJoinAliases(text);
                expect(aliases).toHaveLength(1);
                expect(aliases[0].alias).toBe('s');
            });
        });

        describe('detectClauseContext ignores GROUP BY in comments', () => {
            it('hasGroupBy is false when GROUP BY is inside a line comment', () => {
                const text = 'SELECT * FROM c -- GROUP BY c.type\nWHERE c.age > 10 ';
                const ctx = detectClauseContext(text, text.length);
                expect(ctx.hasGroupBy).toBe(false);
            });

            it('hasGroupBy is false when GROUP BY is inside a block comment', () => {
                const text = 'SELECT * FROM c /* GROUP BY c.type */ WHERE c.age > 10 ';
                const ctx = detectClauseContext(text, text.length);
                expect(ctx.hasGroupBy).toBe(false);
            });

            it('hasGroupBy is true when GROUP BY is outside comments', () => {
                const text = 'SELECT c.type, COUNT(1) FROM c /* filter */ GROUP BY c.type';
                const ctx = detectClauseContext(text, 7);
                expect(ctx.hasGroupBy).toBe(true);
            });
        });
    });
});
