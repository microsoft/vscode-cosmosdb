/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseMultiQueryDocument } from './MultiQueryDocument.js';
import { SqlLanguageService } from './SqlLanguageService.js';

// ========================== parseMultiQueryDocument ===========================

describe('parseMultiQueryDocument', () => {
    it('single query without semicolon', () => {
        const doc = parseMultiQueryDocument('SELECT * FROM c');
        expect(doc.regions).toHaveLength(1);
        expect(doc.regions[0].text).toBe('SELECT * FROM c');
        expect(doc.regions[0].startOffset).toBe(0);
        expect(doc.regions[0].endOffset).toBe(15);
        expect(doc.regions[0].parseResult).not.toBeNull();
        expect(doc.regions[0].parseResult!.errors).toHaveLength(0);
    });

    it('single query with trailing semicolon', () => {
        const doc = parseMultiQueryDocument('SELECT * FROM c;');
        expect(doc.regions).toHaveLength(2);
        expect(doc.regions[0].text).toBe('SELECT * FROM c');
        expect(doc.regions[0].parseResult).not.toBeNull();
        // Second region is empty (after the semicolon)
        expect(doc.regions[1].text).toBe('');
        expect(doc.regions[1].parseResult).toBeNull();
    });

    it('two queries separated by semicolon', () => {
        const doc = parseMultiQueryDocument('SELECT * FROM c; SELECT c.id FROM c');
        expect(doc.regions).toHaveLength(2);
        expect(doc.regions[0].text).toBe('SELECT * FROM c');
        expect(doc.regions[0].startOffset).toBe(0);
        expect(doc.regions[0].endOffset).toBe(16); // includes `;`
        expect(doc.regions[1].text).toBe(' SELECT c.id FROM c');
        expect(doc.regions[1].startOffset).toBe(16);
        expect(doc.regions[1].endOffset).toBe(35);
    });

    it('three queries', () => {
        const text = 'SELECT 1; SELECT 2; SELECT 3';
        const doc = parseMultiQueryDocument(text);
        expect(doc.regions).toHaveLength(3);
        expect(doc.regions[0].text).toBe('SELECT 1');
        expect(doc.regions[1].text).toBe(' SELECT 2');
        expect(doc.regions[2].text).toBe(' SELECT 3');
    });

    it('semicolon inside string literal is NOT a separator', () => {
        const text = "SELECT 'a;b' FROM c";
        const doc = parseMultiQueryDocument(text);
        expect(doc.regions).toHaveLength(1);
        expect(doc.regions[0].text).toBe(text);
    });

    it('semicolon inside block comment is NOT a separator', () => {
        const text = '/* ; */ SELECT * FROM c';
        const doc = parseMultiQueryDocument(text);
        expect(doc.regions).toHaveLength(1);
        expect(doc.regions[0].text).toBe(text);
    });

    it('semicolon inside line comment is NOT a separator', () => {
        const text = '-- ;\nSELECT * FROM c';
        const doc = parseMultiQueryDocument(text);
        expect(doc.regions).toHaveLength(1);
        expect(doc.regions[0].text).toBe(text);
    });

    it('consecutive semicolons produce empty regions', () => {
        const doc = parseMultiQueryDocument('SELECT 1;; SELECT 2');
        expect(doc.regions).toHaveLength(3);
        expect(doc.regions[0].text).toBe('SELECT 1');
        expect(doc.regions[1].text).toBe('');
        expect(doc.regions[1].parseResult).toBeNull();
        expect(doc.regions[2].text).toBe(' SELECT 2');
    });

    it('whitespace-only region is parsed as null', () => {
        const doc = parseMultiQueryDocument('SELECT 1;   ; SELECT 2');
        expect(doc.regions).toHaveLength(3);
        expect(doc.regions[1].text).toBe('   ');
        expect(doc.regions[1].parseResult).toBeNull();
    });

    it('empty input produces single empty region', () => {
        const doc = parseMultiQueryDocument('');
        expect(doc.regions).toHaveLength(1);
        expect(doc.regions[0].text).toBe('');
        expect(doc.regions[0].parseResult).toBeNull();
    });
});

// ========================== Offset mapping ====================================

describe('MultiQueryDocument offset mapping', () => {
    const text = 'SELECT 1; SELECT 2; SELECT 3';
    //            0         1         2
    //            0123456789012345678901234567

    it('regionAtOffset finds correct region', () => {
        const doc = parseMultiQueryDocument(text);
        expect(doc.regionAtOffset(0)?.index).toBe(0);
        expect(doc.regionAtOffset(5)?.index).toBe(0);
        expect(doc.regionAtOffset(10)?.index).toBe(1);
        expect(doc.regionAtOffset(20)?.index).toBe(2);
    });

    it('regionAtOffset at boundary returns correct region', () => {
        const doc = parseMultiQueryDocument(text);
        // Offset 8 is the `;` → belongs to region 0
        expect(doc.regionAtOffset(8)?.index).toBe(0);
        // Offset 10 is start of region 1
        expect(doc.regionAtOffset(10)?.index).toBe(1);
    });

    it('toLocalOffset computes correct local offset', () => {
        const doc = parseMultiQueryDocument(text);
        // Region 1 starts at semicolonOffset+1
        const region1Start = doc.regions[1].startOffset;
        const result = doc.toLocalOffset(region1Start + 2);
        expect(result).toBeDefined();
        expect(result!.region.index).toBe(1);
        expect(result!.localOffset).toBe(2);
    });

    it('toDocumentOffset converts back correctly', () => {
        const doc = parseMultiQueryDocument(text);
        const region = doc.regions[2];
        expect(doc.toDocumentOffset(region, 3)).toBe(region.startOffset + 3);
    });

    it('regionAtOffset at end of document returns last region', () => {
        const doc = parseMultiQueryDocument(text);
        expect(doc.regionAtOffset(text.length)?.index).toBe(2);
    });
});

// ========================== SqlLanguageService multi-query ====================

describe('SqlLanguageService with multiQuery', () => {
    const service = new SqlLanguageService({ multiQuery: true });

    describe('getDiagnostics', () => {
        it('returns no diagnostics for valid multi-query', () => {
            const diags = service.getDiagnostics('SELECT * FROM c; SELECT c.id FROM c');
            expect(diags).toHaveLength(0);
        });

        it('returns diagnostics with correct document offsets', () => {
            // First query valid, second query invalid (SELECT without FROM)
            const text = 'SELECT * FROM c; SELECT * FORM';
            const diags = service.getDiagnostics(text);
            expect(diags.length).toBeGreaterThan(0);
            // All diagnostics should point into the second region (offset >= 16)
            for (const d of diags) {
                expect(d.range.startOffset).toBeGreaterThanOrEqual(16);
            }
        });

        it('returns diagnostics from multiple regions', () => {
            // Both regions have genuinely broken SQL (missing FROM clause)
            const text = 'SELECT * FORM; SELECT * FORM';
            const diags = service.getDiagnostics(text);
            // Should have errors from both regions
            expect(diags.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('getCompletions', () => {
        it('returns completions scoped to the active region', () => {
            // Cursor at offset 25 is inside "SELECT |" in region 1
            const text = 'SELECT * FROM c; SELECT ';
            const completions = service.getCompletions(text, text.length);
            expect(completions.length).toBeGreaterThan(0);
        });
    });

    describe('getHoverInfo', () => {
        it('returns hover for keyword in second region', () => {
            const text = 'SELECT * FROM c; SELECT * FROM c';
            // "SELECT" in second region starts at offset 17
            const hover = service.getHoverInfo(text, 17);
            expect(hover).not.toBeNull();
            expect(hover!.contents.length).toBeGreaterThan(0);
            // Range should be in document coordinates
            if (hover!.range) {
                expect(hover!.range.startOffset).toBeGreaterThanOrEqual(17);
            }
        });
    });

    describe('format', () => {
        it('formats each region independently and joins with semicolons', () => {
            const text = 'select * from c;select c.id from c';
            const formatted = service.format(text);
            // Should contain two formatted queries joined by ;\n\n
            expect(formatted).toContain(';\n\n');
            const parts = formatted.split(';\n\n');
            expect(parts).toHaveLength(2);
        });
    });

    describe('parseDocument', () => {
        it('returns MultiQueryDocument', () => {
            const doc = service.parseDocument('SELECT 1; SELECT 2');
            expect(doc.regions).toHaveLength(2);
        });
    });

    describe('getActiveRegion', () => {
        it('returns the correct region for a cursor offset', () => {
            const text = 'SELECT 1; SELECT 2; SELECT 3';
            const region = service.getActiveRegion(text, 12);
            expect(region).toBeDefined();
            expect(region!.index).toBe(1);
        });
    });
});

// ========================== Backward compatibility ============================

describe('SqlLanguageService without multiQuery (default)', () => {
    const service = new SqlLanguageService();

    it('treats semicolons as part of the single query', () => {
        // Without multiQuery, the service parses the whole text as one query
        // Semicolons will cause parse errors (they're not part of single query grammar)
        const diags = service.getDiagnostics('SELECT * FROM c; SELECT * FROM c');
        // The parser should report errors because `;` is unexpected after single query
        expect(diags.length).toBeGreaterThan(0);
    });

    it('parse returns single ParseResult', () => {
        const result = service.parse('SELECT * FROM c');
        expect(result.errors).toHaveLength(0);
        expect(result.ast).toBeDefined();
    });
});

