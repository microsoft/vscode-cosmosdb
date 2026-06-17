/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parse } from '../index.js';
import { SqlLanguageService } from '../services/SqlLanguageService.js';
import { DiagnosticSeverity } from '../services/types.js';
import { detectOrderByInSubquery } from './orderByInSubquery.js';

// ========================== detectOrderByInSubquery unit tests ================

function detect(query: string) {
    return detectOrderByInSubquery(parse(query).ast);
}

describe('detectOrderByInSubquery', () => {
    // ─── Should flag ─────────────────────────────────────────────────

    it('flags ORDER BY inside a FIRST subquery', () => {
        const errors = detect(
            'SELECT c.id, FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.unitPrice DESC) AS m FROM c',
        );
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('ORDER BY');
    });

    it('flags ORDER BY inside a LAST subquery', () => {
        const errors = detect(
            'SELECT c.id, LAST(SELECT VALUE i FROM i IN c.items ORDER BY i.unitPrice DESC) AS m FROM c',
        );
        expect(errors).toHaveLength(1);
    });

    it('flags ORDER BY inside an ARRAY subquery', () => {
        const errors = detect('SELECT c.id, ARRAY(SELECT VALUE i FROM i IN c.items ORDER BY i.unitPrice) AS r FROM c');
        expect(errors).toHaveLength(1);
    });

    it('flags ORDER BY inside an EXISTS subquery', () => {
        const errors = detect(
            'SELECT c.id FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.unitPrice > 100 ORDER BY i.unitPrice DESC)',
        );
        expect(errors).toHaveLength(1);
    });

    it('flags ORDER BY inside a scalar (SELECT …) subquery', () => {
        const errors = detect(
            'SELECT c.id, (SELECT VALUE COUNT(1) FROM i IN c.items ORDER BY i.unitPrice) AS n FROM c',
        );
        expect(errors).toHaveLength(1);
    });

    it('flags ORDER BY inside a FROM-clause subquery', () => {
        const errors = detect('SELECT s.id FROM (SELECT VALUE c FROM c ORDER BY c.id) AS s');
        expect(errors).toHaveLength(1);
    });

    it('flags multiple offending subqueries independently', () => {
        const errors = detect(
            'SELECT FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.p) AS a, ' +
                'LAST(SELECT VALUE j FROM j IN c.items ORDER BY j.p) AS b FROM c',
        );
        expect(errors).toHaveLength(2);
    });

    it('points the range at the inner ORDER BY, not the whole query', () => {
        const query = 'SELECT c.id, FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.unitPrice DESC) AS m FROM c';
        const [err] = detect(query);
        expect(query.slice(err.range.start.offset, err.range.end.offset)).toContain('ORDER BY');
    });

    // ─── Should NOT flag ─────────────────────────────────────────────

    it('does not flag top-level ORDER BY', () => {
        expect(detect('SELECT * FROM c ORDER BY c.price DESC')).toHaveLength(0);
    });

    it('does not flag subqueries without ORDER BY', () => {
        expect(detect('SELECT c.id, FIRST(SELECT VALUE i FROM i IN c.items) AS m FROM c')).toHaveLength(0);
        expect(detect('SELECT c.id, ARRAY(SELECT VALUE i FROM i IN c.items) AS r FROM c')).toHaveLength(0);
        expect(detect('SELECT c.id FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.p > 1)')).toHaveLength(
            0,
        );
    });

    it('flags only the inner ORDER BY when the outer query also sorts', () => {
        const errors = detect(
            'SELECT c.id, FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.p) AS m FROM c ORDER BY c.id',
        );
        expect(errors).toHaveLength(1);
    });

    it('returns empty for an unparseable query (parser reports it instead)', () => {
        expect(detect('SELECT FROM')).toHaveLength(0);
    });
});

// ========================== Service integration ===============================

describe('SqlLanguageService.getDiagnostics — ORDER BY in subquery', () => {
    it('emits an Error diagnostic with the ORDER_BY_IN_SUBQUERY code', () => {
        const service = new SqlLanguageService();
        const diags = service.getDiagnostics(
            'SELECT c.id, FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.unitPrice DESC) AS m FROM c',
        );
        const subqueryErrors = diags.filter((d) => d.code === 'ORDER_BY_IN_SUBQUERY');
        expect(subqueryErrors).toHaveLength(1);
        expect(subqueryErrors[0].severity).toBe(DiagnosticSeverity.Error);
    });

    it('does not emit for a valid top-level ORDER BY query', () => {
        const service = new SqlLanguageService();
        const diags = service.getDiagnostics('SELECT * FROM c ORDER BY c.price DESC');
        expect(diags.filter((d) => d.code === 'ORDER_BY_IN_SUBQUERY')).toHaveLength(0);
    });

    it('reports document-level offsets in multi-query mode', () => {
        const service = new SqlLanguageService({ multiQuery: true });
        const text = 'SELECT * FROM c;\nSELECT FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.p) AS m FROM c';
        const diags = service.getDiagnostics(text).filter((d) => d.code === 'ORDER_BY_IN_SUBQUERY');
        expect(diags).toHaveLength(1);
        // Offset must land within the second statement, after the newline.
        expect(diags[0].range.startOffset).toBeGreaterThan(text.indexOf('\n'));
    });
});
