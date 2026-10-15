/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { parse, SqlErrorCode, SqlLanguageService, sqlToString } from '../index.js';
import { SqlLexer } from '../lexer/SqlLexer.js';
import { MAX_AST_DEPTH } from './queryComplexity.js';

describe('query complexity', () => {
    it('rejects excessive nesting without exhausting the stack and can parse again', () => {
        const query = `SELECT VALUE ${'('.repeat(1000)}1${')'.repeat(1000)}`;
        const result = parse(query);
        expect(result.ast).toBeUndefined();
        expect(result.errors).toContainEqual(expect.objectContaining({ code: SqlErrorCode.QueryTooComplex }));
        expect(parse('SELECT * FROM c').errors).toEqual([]);
    });

    it.each([
        ['unary operators', `${'NOT '.repeat(1000)}true`],
        ['coalesce operators', `${'null ?? '.repeat(1000)}1`],
        ['conditional operators', `${'true ? 1 : '.repeat(1000)}0`],
        ['function calls', `${'ABS('.repeat(1000)}1${')'.repeat(1000)}`],
        ['arrays', `${'['.repeat(1000)}1${']'.repeat(1000)}`],
        ['objects', `${'{"x":'.repeat(1000)}1${'}'.repeat(1000)}`],
        ['subqueries', `${'(SELECT VALUE '.repeat(1000)}1${')'.repeat(1000)}`],
        ['left-associative operators', Array(1000).fill('1').join(' + ')],
    ])('bounds %s through parsing, diagnostics and formatting', (_name, expression) => {
        const query = `SELECT VALUE ${expression}`;
        const result = parse(query);
        expect(result.ast).toBeUndefined();
        const error = result.errors.find((e) => e.code === SqlErrorCode.QueryTooComplex);
        expect(error).toBeDefined();
        expect(error!.range.start.offset).toBeGreaterThanOrEqual(0);
        expect(error!.range.end.offset).toBeLessThanOrEqual(query.length);
        const service = new SqlLanguageService();
        expect(service.getDiagnostics(query)).toContainEqual(
            expect.objectContaining({ code: SqlErrorCode.QueryTooComplex }),
        );
        expect(service.format(query)).toBe(query);
        expect(service.getDiagnostics('SELECT * FROM c')).toEqual([]);
    });

    it('accepts the AST depth limit and rejects the next level', () => {
        // Program -> Query -> SelectClause -> SelectValueSpec -> binary chain -> literal expression -> literal.
        const query = (terms: number) => `SELECT VALUE ${Array(terms).fill('1').join(' + ')}`;
        const accepted = parse(query(MAX_AST_DEPTH - 5));
        expect(accepted.errors).toEqual([]);
        expect(() => sqlToString(accepted.ast!)).not.toThrow();
        expect(parse(query(MAX_AST_DEPTH - 4)).errors).toContainEqual(
            expect.objectContaining({ code: SqlErrorCode.QueryTooComplex }),
        );
    });

    it('allows wide queries and ignores delimiters inside strings and comments', () => {
        const wide = `SELECT ${Array.from({ length: 1000 }, (_, i) => `c.f${i}`).join(', ')} FROM c`;
        expect(parse(wide).errors).toEqual([]);
        expect(parse(`SELECT VALUE "${'('.repeat(2000)}" /* ${'('.repeat(2000)} */`).errors).toEqual([]);
    });

    it('keeps subsequent multi-query regions usable after rejecting a complex query', () => {
        const query = `SELECT VALUE ${'('.repeat(1000)}1${')'.repeat(1000)}; SELECT * FROM c`;
        const service = new SqlLanguageService({ multiQuery: true });
        const doc = service.parseDocument(query);
        expect(doc.regions[0].parseResult?.errors[0].code).toBe(SqlErrorCode.QueryTooComplex);
        expect(doc.regions[1].parseResult?.errors).toEqual([]);
        expect(service.getDiagnostics(query)).toContainEqual(
            expect.objectContaining({ code: SqlErrorCode.QueryTooComplex }),
        );
    });

    it('does not convert unexpected implementation exceptions into complexity diagnostics', () => {
        const failure = new RangeError('Unrelated lexer failure');
        const tokenize = vi.spyOn(SqlLexer, 'tokenize').mockImplementationOnce(() => {
            throw failure;
        });
        try {
            expect(() => parse('SELECT * FROM c')).toThrow(failure);
        } finally {
            tokenize.mockRestore();
        }
        expect(parse('SELECT * FROM c').errors).toEqual([]);
    });
});
