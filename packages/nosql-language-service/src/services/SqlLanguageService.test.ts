/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '../index.js';
import { getFunctionDoc, getKeywordDoc } from './docLoader.js';
import { SqlLanguageService } from './SqlLanguageService.js';
import { DiagnosticSeverity } from './types.js';

describe('SqlLanguageService ranked ORDER BY diagnostics', () => {
    const message = 'Specifying a sort order (ASC or DESC) in the ORDER BY RANK clause is not allowed.';

    it.each([
        ['VectorDistance(c.embedding, @query)', 'ASC'],
        ['VectorDistance(c.embedding, @query)', 'DESC'],
        ['FullTextScore(c.text, "cosmos")', 'ASC'],
        ['FullTextScore(c.text, "cosmos")', 'DESC'],
        ['RRF(FullTextScore(c.text, "cosmos"), VectorDistance(c.embedding, @query))', 'DESC'],
    ])('reports an explicit direction on %s %s without changing parsing', (score, direction) => {
        const query = `SELECT TOP 10 c.id FROM c ORDER BY RANK ${score} ${direction}`;
        expect(parse(query).errors).toEqual([]);
        const diagnostics = new SqlLanguageService().getDiagnostics(query);
        expect(diagnostics).toEqual([
            expect.objectContaining({
                code: 'RANKED_ORDER_BY_SORT_ORDER',
                severity: DiagnosticSeverity.Error,
                message,
            }),
        ]);
        const range = diagnostics[0].range;
        expect(query.slice(range.startOffset, range.endOffset)).toBe(`ORDER BY RANK ${score} ${direction}`);
    });

    it.each([
        'SELECT TOP 10 c.id FROM c ORDER BY RANK VectorDistance(c.embedding, @query)',
        'SELECT TOP 10 c.id FROM c ORDER BY RANK FullTextScore(c.text, "cosmos")',
        'SELECT TOP 10 c.id FROM c ORDER BY RANK RRF(FullTextScore(c.text, "cosmos"), VectorDistance(c.embedding, @query))',
        'SELECT TOP 10 c.id FROM c ORDER BY VectorDistance(c.embedding, @query)',
        'SELECT c.id FROM c ORDER BY c.id ASC',
        'SELECT c.id FROM c ORDER BY c.id DESC',
    ])('keeps supported ordering free of rank-direction diagnostics: %s', (query) => {
        expect(new SqlLanguageService().getDiagnostics(query)).toEqual([]);
    });

    it('maps rank-direction ranges to the multi-query document', () => {
        const query = 'SELECT 1;\n\nSELECT c.id FROM c\nORDER BY RANK VectorDistance(c.embedding, @query) ASC;';
        const diagnostics = new SqlLanguageService({ multiQuery: true }).getDiagnostics(query);
        expect(diagnostics).toEqual([
            expect.objectContaining({
                code: 'RANKED_ORDER_BY_SORT_ORDER',
                severity: DiagnosticSeverity.Error,
                message,
                range: {
                    startOffset: query.indexOf('ORDER BY'),
                    endOffset: query.indexOf(' ASC') + 4,
                    startLine: 4,
                    startColumn: 1,
                    endLine: 4,
                    endColumn: 'ORDER BY RANK VectorDistance(c.embedding, @query) ASC'.length + 1,
                },
            }),
        ]);
    });

    it('reports both invalid query blocks without flagging comment text', () => {
        const query = [
            '-- ORDER BY RANK VectorDistance(c.embedding, @query) ASC',
            'SELECT c.id FROM c ORDER BY RANK FullTextScore(c.text, "cosmos") DESC;',
            'SELECT c.id FROM c ORDER BY RANK VectorDistance(c.embedding, @query) ASC;',
        ].join('\n');
        const diagnostics = new SqlLanguageService({ multiQuery: true }).getDiagnostics(query);
        expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            'RANKED_ORDER_BY_SORT_ORDER',
            'RANKED_ORDER_BY_SORT_ORDER',
        ]);
        expect(diagnostics.map((diagnostic) => diagnostic.range.startLine)).toEqual([2, 3]);
        for (const diagnostic of diagnostics) {
            expect(query.slice(diagnostic.range.startOffset, diagnostic.range.endOffset)).toMatch(/^ORDER BY RANK /);
        }
    });

    it.each(['SELECT c.id FROM c ORDER BY RANK', 'SELECT c.id FROM c ORDER BY RANK VectorDistance('])(
        'does not throw while a ranked query is incomplete: %s',
        (query) => {
            for (const multiQuery of [false, true]) {
                expect(() => new SqlLanguageService({ multiQuery }).getDiagnostics(query)).not.toThrow();
            }
        },
    );

    it('retains the existing nested ORDER BY diagnostic', () => {
        const query =
            'SELECT VALUE ARRAY(SELECT VALUE item FROM item IN c.items ORDER BY RANK FullTextScore(item.text, "cosmos") ASC) FROM c';
        expect(new SqlLanguageService().getDiagnostics(query)).toEqual([
            expect.objectContaining({ code: 'ORDER_BY_IN_SUBQUERY', severity: DiagnosticSeverity.Error }),
        ]);
    });
});

describe('SqlLanguageService query guidance', () => {
    it.each(['STRINGEQUALS', 'StringEquals', 'stringequals'])(
        'provides signature help for %s with the ignore-case default',
        (name) => {
            const query = `SELECT VALUE ${name}(c.name, @name, true)`;
            const help = new SqlLanguageService().getSignatureHelp(query, query.indexOf('true') + 1);
            expect(help?.activeParameter).toBe(2);
            expect(help?.signatures[0].label).toBe('STRINGEQUALS(string1, string2 [, ignoreCase])');
            expect(help?.signatures[0].parameters[2].documentation).toContain('false (default)');
        },
    );

    it('describes vector options consistently in signature help and hover', () => {
        const query = 'SELECT VectorDistance(c.embedding, @queryVector, false, {}) FROM c';
        const service = new SqlLanguageService();
        const help = service.getSignatureHelp(query, query.indexOf('{}') + 1);
        expect(help?.activeParameter).toBe(3);
        expect(help?.signatures[0].label).toBe('VECTORDISTANCE(vector1, vector2 [, brute_force [, options]])');
        expect(help?.signatures[0].parameters[3].label).toBe('options');
        expect(help?.signatures[0].parameters[3].documentation).toContain('JSON object');
        expect(help?.signatures[0].parameters[2].documentation).toContain('if one exists');
        const hover = service.getHoverInfo(query, query.indexOf('VectorDistance'))?.contents.join('\n');
        expect(hover).toContain('fourth argument is an object');
        expect(hover).toContain('regular `ORDER BY VectorDistance(...)`');
    });

    it('keeps embedded ordering and pagination guidance consistent', () => {
        expect(getKeywordDoc('ORDER_BY')).toContain('reversed on every path');
        expect(getKeywordDoc('ORDER_BY')).toContain('Explicit `ASC` or `DESC` is not allowed');
        expect(getKeywordDoc('OFFSET')).toContain('continuation-token');
        expect(getFunctionDoc('StringEquals')).toContain('false` (default)');
    });

    it.each([
        'SELECT COUNT(1) AS count FROM c',
        'SELECT VALUE COUNT(1) FROM c',
        'SELECT DISTINCT c.category FROM c',
        'SELECT DISTINCT VALUE c.category FROM c',
        'SELECT TOP @limit c.id FROM c',
        'SELECT c.id FROM c ORDER BY c.id OFFSET @skip LIMIT @take',
        'SELECT c.category, c.price FROM c ORDER BY c.category DESC, c.price ASC',
        'SELECT TOP 10 c.id FROM c ORDER BY VectorDistance(c.embedding, @query, false, {distanceFunction: "Cosine"})',
    ])('accepts the supported query form: %s', (query) => {
        expect(new SqlLanguageService().getDiagnostics(query)).toEqual([]);
    });
});

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
        const secondRegion = regions.find(
            (r) => text.substring(r.contentStartOffset, r.contentEndOffset) === 'SELECT 2',
        );
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

describe('SqlLanguageService.getActiveBlockOffsets', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns null for a single query', () => {
        expect(service.getActiveBlockOffsets('SELECT * FROM c', 3)).toBeNull();
    });

    it('returns null for a single query with trailing semicolon (one non-empty region)', () => {
        expect(service.getActiveBlockOffsets('SELECT * FROM c;', 3)).toBeNull();
    });

    it('resolves the active block under the cursor', () => {
        const text = 'SELECT 1;\nSELECT 2;';
        const cursor = text.indexOf('SELECT 2');
        const block = service.getActiveBlockOffsets(text, cursor);
        expect(block).not.toBeNull();
        expect(text.substring(block!.startOffset, block!.endOffset)).toBe('SELECT 2');
    });

    it('strips leading whitespace from the active block', () => {
        const text = 'SELECT 1;\n\n   SELECT 2;';
        const cursor = text.indexOf('SELECT 2');
        const block = service.getActiveBlockOffsets(text, cursor);
        expect(block).not.toBeNull();
        // startOffset must point at 'S', not the preceding whitespace/newlines.
        expect(text[block!.startOffset]).toBe('S');
        expect(text.substring(block!.startOffset, block!.endOffset)).toBe('SELECT 2');
    });

    it('strips trailing whitespace from the active block', () => {
        const text = 'SELECT 1;\nSELECT 2   ;';
        const cursor = text.indexOf('SELECT 2');
        const block = service.getActiveBlockOffsets(text, cursor);
        expect(block).not.toBeNull();
        const content = text.substring(block!.startOffset, block!.endOffset);
        expect(content).toBe(content.trim());
        expect(content).toBe('SELECT 2');
    });

    it('returns null when the cursor sits in a whitespace-only region', () => {
        const text = 'SELECT 1;   ;SELECT 2;';
        const cursor = text.indexOf('   ;') + 1; // inside the blank region between ;;
        expect(service.getActiveBlockOffsets(text, cursor)).toBeNull();
    });

    it('endOffset is exclusive (last highlighted char is endOffset - 1)', () => {
        const text = 'SELECT 1;\nSELECT 2;';
        const cursor = text.indexOf('SELECT 2');
        const block = service.getActiveBlockOffsets(text, cursor)!;
        expect(text[block.endOffset - 1]).toBe('2');
    });
});
