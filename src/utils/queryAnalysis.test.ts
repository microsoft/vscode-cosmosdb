/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    QueryResultMismatchError,
    getDocumentCollectionKind,
    getQueryColumns,
    getQueryResultKind,
    isSelectStar,
} from './queryAnalysis';

describe('queryAnalysis', () => {
    // ─── isSelectStar ────────────────────────────────────────────────────────────

    describe('isSelectStar', () => {
        it('returns true for SELECT *', () => {
            expect(isSelectStar('SELECT * FROM c')).toBe(true);
        });

        it('returns false for SELECT list', () => {
            expect(isSelectStar('SELECT c.id, c.name FROM c')).toBe(false);
        });

        it('returns false for SELECT VALUE', () => {
            expect(isSelectStar('SELECT VALUE c.name FROM c')).toBe(false);
        });

        it('is not fooled by arithmetic multiplication', () => {
            // c.price * c.qty should NOT be detected as SELECT *
            expect(isSelectStar('SELECT c.price * c.qty FROM c')).toBe(false);
        });

        it('returns false for an empty string', () => {
            expect(isSelectStar('')).toBe(false);
        });
    });

    // ─── getQueryColumns ─────────────────────────────────────────────────────────

    describe('getQueryColumns', () => {
        it('returns null for SELECT *', () => {
            expect(getQueryColumns('SELECT * FROM c')).toBeNull();
        });

        it('returns null for SELECT VALUE scalar', () => {
            expect(getQueryColumns('SELECT VALUE c.name FROM c')).toBeNull();
        });

        it('returns null for SELECT VALUE array / function call', () => {
            expect(getQueryColumns('SELECT VALUE ARRAY_LENGTH(c.tags) FROM c')).toBeNull();
        });

        it('extracts property names from SELECT list', () => {
            expect(getQueryColumns('SELECT c.id, c.name, c.age FROM c')).toEqual(['id', 'name', 'age']);
        });

        it('uses the last path segment for nested paths', () => {
            expect(getQueryColumns('SELECT c.address.city FROM c')).toEqual(['city']);
        });

        it('uses AS alias when present', () => {
            expect(getQueryColumns('SELECT c.name AS fullName FROM c')).toEqual(['fullName']);
        });

        it('returns null for unnamed column (arithmetic without alias)', () => {
            expect(getQueryColumns('SELECT c.price * c.qty FROM c')).toEqual([null]);
        });

        it('extracts keys from SELECT VALUE { ... } object literal', () => {
            expect(getQueryColumns('SELECT VALUE { "x": c.lng, "y": c.lat } FROM c')).toEqual(['x', 'y']);
        });

        it('returns null for unparseable / empty query', () => {
            expect(getQueryColumns('')).toBeNull();
        });
    });

    // ─── getQueryResultKind ──────────────────────────────────────────────────────

    describe('getQueryResultKind', () => {
        it('returns "object" for SELECT *', () => {
            expect(getQueryResultKind('SELECT * FROM c')).toBe('object');
        });

        it('returns "object" for SELECT list', () => {
            expect(getQueryResultKind('SELECT c.id, c.name FROM c')).toBe('object');
        });

        it('returns "object" for SELECT VALUE { ... } (object literal)', () => {
            expect(getQueryResultKind('SELECT VALUE { "a": c.x } FROM c')).toBe('object');
        });

        it('returns "primitive" for SELECT VALUE scalar', () => {
            expect(getQueryResultKind('SELECT VALUE c.name FROM c')).toBe('primitive');
        });

        it('returns "primitive" for SELECT VALUE function call', () => {
            expect(getQueryResultKind('SELECT VALUE UPPER(c.name) FROM c')).toBe('primitive');
        });

        it('returns "primitive" for SELECT VALUE array', () => {
            expect(getQueryResultKind('SELECT VALUE [1, 2, 3] FROM c')).toBe('primitive');
        });

        it('returns "unknown" for null', () => {
            expect(getQueryResultKind(null)).toBe('unknown');
        });

        it('returns "unknown" for undefined', () => {
            expect(getQueryResultKind(undefined)).toBe('unknown');
        });

        it('returns "unknown" for empty string', () => {
            expect(getQueryResultKind('')).toBe('unknown');
        });
    });

    // ─── getDocumentCollectionKind ───────────────────────────────────────────────

    describe('getDocumentCollectionKind', () => {
        it('returns "empty" for an empty array', () => {
            expect(getDocumentCollectionKind([])).toBe('empty');
        });

        it('returns "object" when all documents are plain objects', () => {
            expect(getDocumentCollectionKind([{ id: '1' }, { id: '2' }])).toBe('object');
        });

        it('returns "primitive" when all documents are strings', () => {
            expect(getDocumentCollectionKind(['Alice', 'Bob'])).toBe('primitive');
        });

        it('returns "primitive" when all documents are numbers', () => {
            expect(getDocumentCollectionKind([1, 2, 3])).toBe('primitive');
        });

        it('returns "primitive" when all documents are null', () => {
            expect(getDocumentCollectionKind([null, null])).toBe('primitive');
        });

        it('returns "primitive" when documents are arrays (top-level arrays have no named keys)', () => {
            expect(
                getDocumentCollectionKind([
                    [1, 2],
                    [3, 4],
                ]),
            ).toBe('primitive');
        });

        it('returns "mixed" when objects and primitives are interleaved', () => {
            expect(getDocumentCollectionKind([{ id: '1' }, 'Alice'])).toBe('mixed');
        });

        it('returns "mixed" when objects and nulls are interleaved', () => {
            expect(getDocumentCollectionKind([{ id: '1' }, null])).toBe('mixed');
        });

        it('returns "mixed" when objects and arrays are interleaved', () => {
            expect(getDocumentCollectionKind([{ id: '1' }, [1, 2]])).toBe('mixed');
        });

        it('short-circuits as soon as both kinds are seen', () => {
            // Large arrays — result should still be 'mixed' and not throw
            const docs = [...Array.from({ length: 500 }, () => ({ id: '1' })), 'primitive'];
            expect(getDocumentCollectionKind(docs)).toBe('mixed');
        });
    });

    // ─── QueryResultMismatchError ────────────────────────────────────────────────

    describe('QueryResultMismatchError', () => {
        it('has name "QueryResultMismatchError"', () => {
            const err = new QueryResultMismatchError('object', 'primitive');
            expect(err.name).toBe('QueryResultMismatchError');
        });

        it('includes queryKind and dataKind in the message', () => {
            const err = new QueryResultMismatchError('object', 'mixed');
            expect(err.message).toContain('object');
            expect(err.message).toContain('mixed');
        });

        it('is instanceof Error', () => {
            expect(new QueryResultMismatchError('primitive', 'object')).toBeInstanceOf(Error);
        });
    });
});
