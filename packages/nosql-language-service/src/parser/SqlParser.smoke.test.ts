/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Smoke test suite — 10 representative SELECT queries.
 *
 * Each query covers a unique AST construct so that a single small PR gives
 * early signal across the full breadth of parser capabilities, from the
 * simplest possible query to a fully-loaded multi-clause query.
 *
 * Full coverage (all ~120 queries) is tracked in plans/plan-nosql-select-tests.md.
 */

import { describe, expect, it } from 'vitest';
import { SqlBinaryScalarOperatorKind, SqlSortOrder } from '../ast/nodes.js';
import { parse } from '../index.js';

describe('smoke — 10 representative SELECT queries', () => {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Absolute baseline: SELECT * FROM c
    //    Covers: SelectStarSpec, AliasedCollectionExpression
    // ─────────────────────────────────────────────────────────────────────────
    it('S-01  SELECT * FROM c', () => {
        const { ast, errors } = parse('SELECT * FROM c');
        expect(errors).toHaveLength(0);
        expect(ast!.query.select.spec.kind).toBe('SelectStarSpec');
        expect(ast!.query.from!.collection.kind).toBe('AliasedCollectionExpression');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. WHERE with AND compound
    //    Covers: BinaryScalarExpression(And) wrapping two comparisons
    // ─────────────────────────────────────────────────────────────────────────
    it('W-10  SELECT * FROM c WHERE c.price > 10 AND c.price < 100', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.price > 10 AND c.price < 100');
        expect(errors).toHaveLength(0);
        const expr = ast!.query.where!.expression;
        expect(expr.kind).toBe('BinaryScalarExpression');
        if (expr.kind !== 'BinaryScalarExpression') return;
        expect(expr.operator).toBe(SqlBinaryScalarOperatorKind.And);
        expect(expr.left.kind).toBe('BinaryScalarExpression');
        expect(expr.right.kind).toBe('BinaryScalarExpression');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. DISTINCT + ORDER BY
    //    Covers: distinct flag, OrderByClause, SqlSortOrder.Ascending
    // ─────────────────────────────────────────────────────────────────────────
    it('S-04+O  SELECT DISTINCT c.category FROM c ORDER BY c.category ASC', () => {
        const { ast, errors } = parse('SELECT DISTINCT c.category FROM c ORDER BY c.category ASC');
        expect(errors).toHaveLength(0);
        expect(ast!.query.select.distinct).toBe(true);
        expect(ast!.query.orderBy).toBeDefined();
        expect(ast!.query.orderBy!.items).toHaveLength(1);
        expect(ast!.query.orderBy!.items[0].sortOrder).toBe(SqlSortOrder.Ascending);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. BETWEEN + IN in combination
    //    Covers: BetweenScalarExpression AND InScalarExpression as siblings
    // ─────────────────────────────────────────────────────────────────────────
    it("B-08  SELECT * FROM c WHERE (c.price BETWEEN 10 AND 100) AND c.category IN ('Electronics', 'Clothing')", () => {
        const { ast, errors } = parse(
            `SELECT * FROM c WHERE (c.price BETWEEN 10 AND 100) AND c.category IN ('Electronics', 'Clothing')`,
        );
        expect(errors).toHaveLength(0);
        const expr = ast!.query.where!.expression;
        expect(expr.kind).toBe('BinaryScalarExpression');
        if (expr.kind !== 'BinaryScalarExpression') return;
        expect(expr.operator).toBe(SqlBinaryScalarOperatorKind.And);
        expect(expr.left.kind).toBe('BetweenScalarExpression');
        expect(expr.right.kind).toBe('InScalarExpression');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 5. JOIN array iterator + WHERE on iterator variable
    //    Covers: JoinCollectionExpression, nested WhereClause
    // ─────────────────────────────────────────────────────────────────────────
    it('J-03  SELECT c.id, item.name FROM c JOIN item IN c.items WHERE item.quantity > 2', () => {
        const { ast, errors } = parse('SELECT c.id, item.name FROM c JOIN item IN c.items WHERE item.quantity > 2');
        expect(errors).toHaveLength(0);
        expect(ast!.query.from!.collection.kind).toBe('JoinCollectionExpression');
        expect(ast!.query.where).toBeDefined();
        expect(ast!.query.where!.expression.kind).toBe('BinaryScalarExpression');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 6. GROUP BY + aggregate with alias
    //    Covers: GroupByClause, FunctionCallScalarExpression, SelectItemAlias
    // ─────────────────────────────────────────────────────────────────────────
    it('G-03  SELECT c.category, AVG(c.rating) AS avgRating FROM c GROUP BY c.category', () => {
        const { ast, errors } = parse('SELECT c.category, AVG(c.rating) AS avgRating FROM c GROUP BY c.category');
        expect(errors).toHaveLength(0);
        expect(ast!.query.groupBy).toBeDefined();
        expect(ast!.query.groupBy!.expressions).toHaveLength(1);
        const spec = ast!.query.select.spec;
        if (spec.kind !== 'SelectListSpec') return;
        expect(spec.items).toHaveLength(2);
        expect(spec.items[1].expression.kind).toBe('FunctionCallScalarExpression');
        expect(spec.items[1].alias?.value).toBe('avgRating');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 7. EXISTS correlated subquery
    //    Covers: ExistsScalarExpression wrapping a full nested SqlQuery
    // ─────────────────────────────────────────────────────────────────────────
    it('E-01  SELECT c.id FROM c WHERE EXISTS(SELECT VALUE t FROM t IN c.tags WHERE t = "sale")', () => {
        const { ast, errors } = parse(
            `SELECT c.id FROM c WHERE EXISTS(SELECT VALUE t FROM t IN c.tags WHERE t = "sale")`,
        );
        expect(errors).toHaveLength(0);
        const expr = ast!.query.where!.expression;
        expect(expr.kind).toBe('ExistsScalarExpression');
        if (expr.kind !== 'ExistsScalarExpression') return;
        // The nested query itself must be a valid query with its own FROM
        expect(expr.subquery.from).toBeDefined();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 8. ARRAY subquery in projection
    //    Covers: ArrayScalarExpression as a SELECT item (data reshaping)
    // ─────────────────────────────────────────────────────────────────────────
    it('SQ-01  SELECT c.id, ARRAY(SELECT VALUE i.name FROM i IN c.items) AS itemNames FROM c', () => {
        const { ast, errors } = parse('SELECT c.id, ARRAY(SELECT VALUE i.name FROM i IN c.items) AS itemNames FROM c');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectListSpec');
        if (spec.kind !== 'SelectListSpec') return;
        expect(spec.items).toHaveLength(2);
        expect(spec.items[1].expression.kind).toBe('ArrayScalarExpression');
        expect(spec.items[1].alias?.value).toBe('itemNames');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 9. All major clauses in one query + parameters
    //    Covers: WHERE BETWEEN @params, GROUP BY, ORDER BY DESC, OFFSET LIMIT
    // ─────────────────────────────────────────────────────────────────────────
    it('CX-06  full query: WHERE BETWEEN @params + GROUP BY + ORDER BY + OFFSET LIMIT', () => {
        const query =
            `SELECT c.type, c.userId, COUNT(1) AS cnt FROM c` +
            ` WHERE (c.timestamp BETWEEN @from AND @to)` +
            ` GROUP BY c.type, c.userId` +
            ` ORDER BY c.type DESC` +
            ` OFFSET 0 LIMIT 20`;
        const { ast, errors } = parse(query);
        expect(errors).toHaveLength(0);
        // WHERE: BETWEEN with parameter refs as bounds
        expect(ast!.query.where!.expression.kind).toBe('BetweenScalarExpression');
        // GROUP BY two expressions
        expect(ast!.query.groupBy).toBeDefined();
        expect(ast!.query.groupBy!.expressions).toHaveLength(2);
        // ORDER BY one item, descending
        expect(ast!.query.orderBy).toBeDefined();
        expect(ast!.query.orderBy!.items[0].sortOrder).toBe(SqlSortOrder.Descending);
        // OFFSET LIMIT present
        expect(ast!.query.offsetLimit).toBeDefined();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 10. Negative: missing selection specification (parser must produce errors)
    //     Covers: error recovery — errors[] non-empty, parse does not throw
    // ─────────────────────────────────────────────────────────────────────────
    it('N-01  SELECT FROM c — parser must reject (errors non-empty)', () => {
        const { errors } = parse('SELECT FROM c');
        expect(errors.length).toBeGreaterThan(0);
    });
});
