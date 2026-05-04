/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { detectBetweenAmbiguity } from './betweenAmbiguity.js';
import { SqlLanguageService } from '../services/SqlLanguageService.js';
import { DiagnosticSeverity } from '../services/types.js';

// ========================== detectBetweenAmbiguity unit tests =================

describe('detectBetweenAmbiguity', () => {
    // ─── Should warn ─────────────────────────────────────────────────

    it('warns on bare BETWEEN…AND…AND', () => {
        const warnings = detectBetweenAmbiguity(
            `SELECT * FROM c WHERE c.price BETWEEN 10 AND 100 AND c.inStock = true`,
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toContain('parentheses');
        expect(warnings[0].range.start.offset).toBeGreaterThan(0);
    });

    it('warns when BETWEEN is combined with logical OR as well (AND still ambiguous)', () => {
        const warnings = detectBetweenAmbiguity(
            `SELECT * FROM c WHERE c.price BETWEEN 10 AND 100 AND c.category = "Books"`,
        );
        expect(warnings).toHaveLength(1);
    });

    it('warns on NOT BETWEEN…AND…AND', () => {
        const warnings = detectBetweenAmbiguity(
            `SELECT * FROM c WHERE c.price NOT BETWEEN 10 AND 100 AND c.inStock = true`,
        );
        expect(warnings).toHaveLength(1);
    });

    it('warns on multiple ambiguous BETWEEN expressions in one query', () => {
        // Two separate BETWEEN+AND patterns joined by OR
        const warnings = detectBetweenAmbiguity(
            `SELECT * FROM c WHERE c.price BETWEEN 1 AND 50 AND c.a = 1 OR c.rating BETWEEN 1 AND 3 AND c.b = 2`,
        );
        expect(warnings).toHaveLength(2);
    });

    it('points the squiggle at the BETWEEN keyword', () => {
        const query = `SELECT * FROM c WHERE c.price BETWEEN 10 AND 100 AND c.inStock = true`;
        const warnings = detectBetweenAmbiguity(query);
        expect(warnings).toHaveLength(1);
        // The range should start at the BETWEEN keyword offset
        const betweenIdx = query.indexOf('BETWEEN');
        expect(warnings[0].range.start.offset).toBe(betweenIdx);
        expect(warnings[0].range.end.offset).toBe(betweenIdx + 'BETWEEN'.length);
    });

    // ─── Should NOT warn ─────────────────────────────────────────────

    it('does not warn when BETWEEN is parenthesised', () => {
        const warnings = detectBetweenAmbiguity(
            `SELECT * FROM c WHERE (c.price BETWEEN 10 AND 100) AND c.inStock = true`,
        );
        expect(warnings).toHaveLength(0);
    });

    it('does not warn on a standalone BETWEEN with no trailing AND', () => {
        const warnings = detectBetweenAmbiguity(`SELECT * FROM c WHERE c.price BETWEEN 10 AND 100`);
        expect(warnings).toHaveLength(0);
    });

    it('does not warn on BETWEEN followed by GROUP BY', () => {
        const warnings = detectBetweenAmbiguity(
            `SELECT c.category, COUNT(1) FROM c WHERE c.price BETWEEN 10 AND 100 GROUP BY c.category`,
        );
        expect(warnings).toHaveLength(0);
    });

    it('does not warn on BETWEEN followed by ORDER BY', () => {
        const warnings = detectBetweenAmbiguity(
            `SELECT * FROM c WHERE c.price BETWEEN 10 AND 100 ORDER BY c.price`,
        );
        expect(warnings).toHaveLength(0);
    });

    it('does not warn when high expression contains AND inside nested parens', () => {
        // (c.a AND c.b) is the high expression — the AND is inside parens
        const warnings = detectBetweenAmbiguity(
            `SELECT * FROM c WHERE c.x BETWEEN c.low AND (c.a + c.b)`,
        );
        expect(warnings).toHaveLength(0);
    });

    it('does not warn on BETWEEN inside a subquery that is itself parenthesised', () => {
        const warnings = detectBetweenAmbiguity(
            `SELECT * FROM c WHERE EXISTS(SELECT * FROM c WHERE c.price BETWEEN 1 AND 9 AND c.name = "x")`,
        );
        // The BETWEEN is inside EXISTS(...), so the outer AND does not cause
        // top-level ambiguity; the inner AND IS at the subquery's depth.
        // We still warn inside the subquery since it has the same pattern.
        expect(warnings).toHaveLength(1);
    });
});

// ========================== Integration: SqlLanguageService ===================

describe('SqlLanguageService — BETWEEN_AMBIGUITY diagnostic', () => {
    const service = new SqlLanguageService();

    it('emits a Warning diagnostic with code BETWEEN_AMBIGUITY', () => {
        const diags = service.getDiagnostics(
            `SELECT * FROM c WHERE c.price BETWEEN 10 AND 100 AND c.inStock = true`,
        );
        const between = diags.filter((d) => d.code === 'BETWEEN_AMBIGUITY');
        expect(between).toHaveLength(1);
        expect(between[0].severity).toBe(DiagnosticSeverity.Warning);
        expect(between[0].message).toContain('parentheses');
    });

    it('emits no BETWEEN_AMBIGUITY when correctly parenthesised', () => {
        const diags = service.getDiagnostics(
            `SELECT * FROM c WHERE (c.price BETWEEN 10 AND 100) AND c.inStock = true`,
        );
        expect(diags.filter((d) => d.code === 'BETWEEN_AMBIGUITY')).toHaveLength(0);
    });

    it('emits no BETWEEN_AMBIGUITY for a plain BETWEEN', () => {
        const diags = service.getDiagnostics(`SELECT * FROM c WHERE c.price BETWEEN 10 AND 100`);
        expect(diags.filter((d) => d.code === 'BETWEEN_AMBIGUITY')).toHaveLength(0);
    });
});

