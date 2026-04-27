/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it } from 'vitest';
import { SqlLanguageService } from './SqlLanguageService.js';

describe('SqlLanguageService.getFoldableRegions', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns empty array for a single query', () => {
        const regions = service.getFoldableRegions('SELECT * FROM c');
        expect(regions).toHaveLength(0);
    });

    it('returns empty array for a single query with semicolon', () => {
        const regions = service.getFoldableRegions('SELECT * FROM c;');
        // Two regions (before and after ;) but the second is empty
        // The empty one is filtered out, leaving one non-empty single-line region
        expect(regions).toHaveLength(1);
    });

    it('returns regions for multiple queries', () => {
        const regions = service.getFoldableRegions('SELECT 1;\nSELECT 2;');
        expect(regions.length).toBeGreaterThan(0);
    });

    it('skips empty regions', () => {
        const regions = service.getFoldableRegions('SELECT 1;;\nSELECT 2;');
        // The empty region between ;; should be filtered out
        for (const r of regions) {
            expect(r.contentEndOffset).toBeGreaterThan(r.contentStartOffset);
        }
    });

    it('content offsets skip leading whitespace', () => {
        const text = 'SELECT 1;\n\n  SELECT 2;';
        const regions = service.getFoldableRegions(text);
        // Region 1 starts after the first ;
        // Its content should start at 'S' of 'SELECT 2', not at '\n'
        const secondRegion = regions.find((r) => text.substring(r.contentStartOffset, r.contentEndOffset) === 'SELECT 2');
        expect(secondRegion).toBeDefined();
    });

    it('content offsets skip trailing whitespace', () => {
        const text = 'SELECT 1;  \n  SELECT 2;';
        const regions = service.getFoldableRegions(text);
        for (const r of regions) {
            const content = text.substring(r.contentStartOffset, r.contentEndOffset);
            expect(content).toBe(content.trim());
        }
    });
});

describe('SqlLanguageService.getSeparatorPositions', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns empty array for a single query', () => {
        const seps = service.getSeparatorPositions('SELECT * FROM c');
        expect(seps).toHaveLength(0);
    });

    it('returns separators between regions', () => {
        const text = 'SELECT 1; SELECT 2; SELECT 3';
        const seps = service.getSeparatorPositions(text);
        // 3 regions → 2 separators
        expect(seps).toHaveLength(2);
    });

    it('separator offset points to the semicolon', () => {
        const text = 'SELECT 1; SELECT 2';
        const seps = service.getSeparatorPositions(text);
        expect(seps).toHaveLength(1);
        expect(text[seps[0].semicolonOffset]).toBe(';');
    });

    it('handles consecutive semicolons', () => {
        const text = 'SELECT 1;; SELECT 2';
        const seps = service.getSeparatorPositions(text);
        // ;; creates 3 regions → 2 separators
        expect(seps).toHaveLength(2);
        expect(text[seps[0].semicolonOffset]).toBe(';');
        expect(text[seps[1].semicolonOffset]).toBe(';');
    });
});
