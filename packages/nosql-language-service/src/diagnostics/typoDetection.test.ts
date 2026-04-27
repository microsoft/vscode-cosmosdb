/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { detectTypos } from './typoDetection.js';
import { SqlLanguageService } from '../services/SqlLanguageService.js';

// ========================== detectTypos unit tests ============================

describe('detectTypos', () => {
    // ─── Should detect common typos ─────────────────────────────────

    it('detects FORM → FROM', () => {
        const warnings = detectTypos('SELECT * FORM c');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('FORM');
        expect(warnings[0].suggestion).toBe('FROM');
    });

    it('detects WHER → WHERE', () => {
        const warnings = detectTypos('SELECT * FROM c WHER c.id = 1');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('WHER');
        expect(warnings[0].suggestion).toBe('WHERE');
    });

    it('detects SELCT → SELECT', () => {
        const warnings = detectTypos('SELCT * FROM c');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('SELCT');
        expect(warnings[0].suggestion).toBe('SELECT');
    });

    it('detects GRUOP → GROUP', () => {
        const warnings = detectTypos('SELECT c.type FROM c GRUOP BY c.type');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('GRUOP');
        expect(warnings[0].suggestion).toBe('GROUP');
    });

    it('detects ORDR → ORDER', () => {
        const warnings = detectTypos('SELECT * FROM c ORDR BY c.id');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('ORDR');
        expect(warnings[0].suggestion).toBe('ORDER');
    });

    it('detects DISTICT → DISTINCT', () => {
        const warnings = detectTypos('SELECT DISTICT c.name FROM c');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('DISTICT');
        expect(warnings[0].suggestion).toBe('DISTINCT');
    });

    it('detects JOINN → JOIN', () => {
        const warnings = detectTypos('SELECT * FROM c JOINN d IN c.items');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('JOINN');
        expect(warnings[0].suggestion).toBe('JOIN');
    });

    it('detects LIMT → LIMIT', () => {
        const warnings = detectTypos('SELECT * FROM c OFFSET 0 LIMT 10');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('LIMT');
        expect(warnings[0].suggestion).toBe('LIMIT');
    });

    it('detects OFSET → OFFSET', () => {
        const warnings = detectTypos('SELECT * FROM c OFSET 0 LIMIT 10');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].typed).toBe('OFSET');
        expect(warnings[0].suggestion).toBe('OFFSET');
    });

    it('detects case-insensitive typo (form → FROM)', () => {
        const warnings = detectTypos('SELECT * form c');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].suggestion).toBe('FROM');
    });

    // ─── Should NOT detect false positives ──────────────────────────

    it('does not flag valid queries', () => {
        const warnings = detectTypos('SELECT * FROM c WHERE c.id = 1');
        expect(warnings).toHaveLength(0);
    });

    it('does not flag short aliases like c, d, f', () => {
        const warnings = detectTypos('SELECT c.id FROM c');
        expect(warnings).toHaveLength(0);
    });

    it('does not flag property access (c.FORM)', () => {
        const warnings = detectTypos('SELECT c.FORM FROM c');
        expect(warnings).toHaveLength(0);
    });

    it('does not flag aliases after AS', () => {
        const warnings = detectTypos('SELECT c.name AS FORM FROM c');
        expect(warnings).toHaveLength(0);
    });

    it('does not flag legitimate identifiers like doc, item, data', () => {
        const warnings = detectTypos('SELECT * FROM doc');
        expect(warnings).toHaveLength(0);
    });

    it('does not flag function names', () => {
        const warnings = detectTypos('SELECT COUNT(c.id) FROM c');
        expect(warnings).toHaveLength(0);
    });

    it('does not flag identifiers after colon (object property)', () => {
        const warnings = detectTypos('SELECT { form: c.name } FROM c');
        expect(warnings).toHaveLength(0);
    });

    // ─── Range correctness ──────────────────────────────────────────

    it('returns correct range for the typo', () => {
        const query = 'SELECT * FORM c';
        const warnings = detectTypos(query);
        expect(warnings).toHaveLength(1);
        expect(query.substring(warnings[0].range.start.offset, warnings[0].range.end.offset)).toBe('FORM');
    });

    it('returns correct line/column for multi-line query', () => {
        const query = 'SELECT *\nFORM c';
        const warnings = detectTypos(query);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].range.start.line).toBe(2);
        expect(warnings[0].range.start.col).toBe(1);
    });
});

// ========================== SqlLanguageService integration ====================

describe('SqlLanguageService typo warnings', () => {
    const service = new SqlLanguageService();

    it('returns typo warning from getDiagnostics', () => {
        const diagnostics = service.getDiagnostics('SELECT * FORM c');
        const warnings = diagnostics.filter((d) => d.code === 'POSSIBLE_TYPO');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings[0].message).toContain('FROM');
        expect(warnings[0].severity).toBe(2); // DiagnosticSeverity.Warning
    });

    it('returns typo warnings in multi-query mode', () => {
        const multiService = new SqlLanguageService({ multiQuery: true });
        const diagnostics = multiService.getDiagnostics('SELECT * FROM c; SELECT * FORM c');
        const warnings = diagnostics.filter((d) => d.code === 'POSSIBLE_TYPO');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        // Warning should point into the second region
        expect(warnings[0].range.startOffset).toBeGreaterThanOrEqual(17);
    });

    it('does not return warnings for valid queries', () => {
        const diagnostics = service.getDiagnostics('SELECT * FROM c WHERE c.id = 1');
        const warnings = diagnostics.filter((d) => d.code === 'POSSIBLE_TYPO');
        expect(warnings).toHaveLength(0);
    });
});

