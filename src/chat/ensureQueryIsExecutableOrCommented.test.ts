/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureQueryIsExecutableOrCommented } from '../utils/sanitization';

describe('ensureQueryIsExecutableOrCommented', () => {
    // --- Pass-through cases (valid queries returned as-is) ---

    it('should return a simple SELECT query unchanged', () => {
        const query = 'SELECT * FROM c';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    it('should return a SELECT query with lowercase keyword unchanged', () => {
        const query = 'select c.id FROM c';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    it('should return a multi-line SELECT query unchanged', () => {
        const query = '-- Find active users\nSELECT c.id, c.name\nFROM c\nWHERE c.status = "active"';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    it('should return a WITH (CTE) query unchanged', () => {
        const query = 'WITH cte AS (SELECT c.id FROM c)\nSELECT * FROM cte';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    it('should return a query with leading comments followed by SELECT unchanged', () => {
        const query = '-- Generated from: find all products\nSELECT * FROM c';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    it('should return a query with leading whitespace before SELECT unchanged', () => {
        const query = '  SELECT c.id FROM c';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    // --- Empty / fully commented cases (returned as-is) ---

    it('should return an empty string as-is', () => {
        expect(ensureQueryIsExecutableOrCommented('')).toBe('');
    });

    it('should return whitespace-only string as-is', () => {
        const query = '   \n  \n  ';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    it('should return a fully commented query as-is', () => {
        const query = '-- This is a comment\n-- Another comment';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    it('should return a single comment line as-is', () => {
        const query = '-- just a comment';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    // --- Comment-out cases (non-query text gets commented) ---

    it('should comment out plain text that is not a query', () => {
        const result = ensureQueryIsExecutableOrCommented('N/A');
        expect(result).toBe('-- N/A');
    });

    it('should comment out a multi-line non-query response', () => {
        const input = 'I cannot generate this query.\nPlease try again.';
        const result = ensureQueryIsExecutableOrCommented(input);
        for (const line of result.split('\n')) {
            if (line.trim()) {
                expect(line.trim().startsWith('--')).toBe(true);
            }
        }
    });

    it('should comment out a response that looks like explanation text', () => {
        const input = 'This query requires a composite index on (category ASC, price DESC)';
        const result = ensureQueryIsExecutableOrCommented(input);
        expect(result.trim().startsWith('--')).toBe(true);
    });

    it('should comment out DML statements like INSERT', () => {
        const result = ensureQueryIsExecutableOrCommented('INSERT INTO c VALUES (1, "test")');
        expect(result.trim().startsWith('--')).toBe(true);
    });

    it('should comment out DELETE statements', () => {
        const result = ensureQueryIsExecutableOrCommented('DELETE FROM c WHERE c.id = "1"');
        expect(result.trim().startsWith('--')).toBe(true);
    });

    it('should comment out UPDATE statements', () => {
        const result = ensureQueryIsExecutableOrCommented('UPDATE c SET c.name = "test"');
        expect(result.trim().startsWith('--')).toBe(true);
    });

    // --- Edge cases ---

    it('should handle SELECT appearing mid-line in non-query text', () => {
        const input = 'Please use SELECT * FROM c to query';
        const result = ensureQueryIsExecutableOrCommented(input);
        expect(result.trim().startsWith('--')).toBe(true);
    });

    it('should preserve original query with trailing newlines when valid', () => {
        const query = 'SELECT * FROM c\n\n';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });

    it('should handle a query with mixed comments and valid SQL', () => {
        const query = '-- comment\n-- another\nSELECT c.id FROM c\n-- trailing';
        expect(ensureQueryIsExecutableOrCommented(query)).toBe(query);
    });
});
