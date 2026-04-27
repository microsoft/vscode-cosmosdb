/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parse, SqlErrorCode } from '../index.js';

describe('Error recovery — never throws', () => {
    const badQueries = [
        '',
        'SELECT',
        'SELECT FROM',
        'SELECT * FORM c',
        'SELECT * FROM c WHERE',
        'SELECT c.',
        'SELECT c.id, , c.name FROM c',
        'SELECT COUNT(',
        'SELECT * FROM c ORDER',
        'SELECT * FROM c ORDER BY',
        'SELECT * FROM',
        'HELLO WORLD',
        'SELECT * FROM c WHERE c.id = ',
        'SELECT * FROM c WHERE AND',
        'SELECT * FROM c JOIN',
        'SELECT * FROM c OFFSET 5',
        'SELECT 1 + FROM c',
        'SELECT * FROM c WHERE c.x BETWEEN',
        'SELECT * FROM c WHERE c.x IN (',
        'SELECT * FROM c WHERE c.x LIKE',
    ];

    for (const q of badQueries) {
        it(`does not throw for: "${q}"`, () => {
            expect(() => parse(q)).not.toThrow();
        });
    }
});

describe('Error recovery — returns errors for invalid queries', () => {
    it('returns error for empty query', () => {
        const { errors } = parse('');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('returns error for incomplete SELECT', () => {
        const { errors } = parse('SELECT');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('returns error for typo FORM instead of FROM', () => {
        const { errors } = parse('SELECT * FORM c');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('returns error for incomplete WHERE', () => {
        const { errors } = parse('SELECT * FROM c WHERE');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('returns error for extra comma in select list', () => {
        const { errors } = parse('SELECT c.id, , c.name FROM c');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('returns error for unclosed function call', () => {
        const { errors } = parse('SELECT COUNT(');
        expect(errors.length).toBeGreaterThan(0);
    });
});

describe('Error recovery — error codes are correct', () => {
    it('empty query gets UNEXPECTED_EOF', () => {
        const { errors } = parse('');
        expect(errors[0].code).toBe(SqlErrorCode.UnexpectedEof);
    });

    it('typo keyword gets MISSING_KEYWORD', () => {
        const { errors } = parse('SELECT * FORM c');
        // FORM is not recognized as FROM → redundant input
        expect(errors[0].code).toBe(SqlErrorCode.MissingKeyword);
    });
});

describe('Error recovery — errors have valid ranges', () => {
    it('error range has valid start/end offsets', () => {
        const { errors } = parse('SELECT * FORM c');
        for (const e of errors) {
            expect(e.range).toBeDefined();
            expect(e.range.start.offset).toBeGreaterThanOrEqual(0);
            expect(e.range.end.offset).toBeGreaterThanOrEqual(e.range.start.offset);
            expect(e.range.start.line).toBeGreaterThanOrEqual(1);
            expect(e.range.start.col).toBeGreaterThanOrEqual(1);
        }
    });

    it('error range points to the right token for trailing garbage', () => {
        const { errors } = parse('SELECT * FORM c');
        // The error should point at "FORM" which starts at offset 9
        expect(errors[0].range.start.offset).toBe(9);
    });
});

describe('Error recovery — partial AST is returned', () => {
    it('typo FORM: still has select clause', () => {
        const { ast } = parse('SELECT * FORM c');
        expect(ast).toBeDefined();
        expect(ast!.kind).toBe('Program');
        expect(ast!.query.select).toBeDefined();
        expect(ast!.query.select.spec.kind).toBe('SelectStarSpec');
    });

    it('extra comma: still has select list items', () => {
        const { ast } = parse('SELECT c.id, , c.name FROM c');
        expect(ast).toBeDefined();
        expect(ast!.query.select.spec.kind).toBe('SelectListSpec');
        if (ast!.query.select.spec.kind === 'SelectListSpec') {
            // Should recover at least some items
            expect(ast!.query.select.spec.items.length).toBeGreaterThan(0);
        }
    });

    it('typo FORM: FROM clause is not present', () => {
        const { ast } = parse('SELECT * FORM c');
        expect(ast).toBeDefined();
        // FORM is not recognized, so no FROM clause
        expect(ast!.query.from).toBeUndefined();
    });

    it('valid query returns no errors', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.age > 21');
        expect(errors).toHaveLength(0);
        expect(ast).toBeDefined();
        expect(ast!.query.where).toBeDefined();
    });
});

describe('Error recovery — multiple errors', () => {
    it('parser can report multiple errors', () => {
        // This query has multiple issues - tests that recovery continues
        const { errors } = parse('SELECT , FROM WHERE');
        expect(errors.length).toBeGreaterThan(0);
    });
});
