/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type * as AST from '../ast/nodes.js';
import { parse, visitNode, type SqlVisitor } from '../index.js';

// ---------------------------------------------------------------------------
// Helper: counting visitor that tracks which kinds were visited
// ---------------------------------------------------------------------------
function createCountingVisitor(): {
    visitor: SqlVisitor<void>;
    counts: Record<string, number>;
} {
    const counts: Record<string, number> = {};
    const inc = (kind: string) => {
        counts[kind] = (counts[kind] ?? 0) + 1;
    };

    const visitor: SqlVisitor<void> = {
        visitProgram(n) {
            inc('Program');
            visitNode(n.query, visitor);
        },
        visitQuery(n) {
            inc('Query');
            visitNode(n.select, visitor);
            if (n.from) visitNode(n.from, visitor);
            if (n.where) visitNode(n.where, visitor);
            if (n.groupBy) visitNode(n.groupBy, visitor);
            if (n.orderBy) visitNode(n.orderBy, visitor);
            if (n.offsetLimit) visitNode(n.offsetLimit, visitor);
        },
        visitSelectClause(n) {
            inc('SelectClause');
            if (n.top) visitNode(n.top, visitor);
            visitNode(n.spec, visitor);
        },
        visitSelectListSpec(n) {
            inc('SelectListSpec');
            for (const item of n.items) visitNode(item, visitor);
        },
        visitSelectValueSpec(n) {
            inc('SelectValueSpec');
            visitScalar(n.expression);
        },
        visitSelectStarSpec() {
            inc('SelectStarSpec');
        },
        visitSelectItem(n) {
            inc('SelectItem');
            visitScalar(n.expression);
        },
        visitTopSpec(n) {
            inc('TopSpec');
            visitScalar(n.value);
        },
        visitFromClause(n) {
            inc('FromClause');
            visitCollection(n.collection);
        },
        visitWhereClause(n) {
            inc('WhereClause');
            visitScalar(n.expression);
        },
        visitGroupByClause(n) {
            inc('GroupByClause');
            for (const e of n.expressions) visitScalar(e);
        },
        visitOrderByClause(n) {
            inc('OrderByClause');
            for (const item of n.items) visitNode(item, visitor);
        },
        visitOrderByItem(n) {
            inc('OrderByItem');
            visitScalar(n.expression);
        },
        visitOffsetLimitClause(n) {
            inc('OffsetLimitClause');
            visitScalar(n.offset.value);
            visitScalar(n.limit.value);
        },
        visitAliasedCollectionExpression(n) {
            inc('AliasedCollectionExpression');
            visitCollection(n.collection);
            if (n.alias) visitNode(n.alias, visitor);
        },
        visitArrayIteratorCollectionExpression(n) {
            inc('ArrayIteratorCollectionExpression');
            visitNode(n.identifier, visitor);
            visitCollection(n.collection);
        },
        visitJoinCollectionExpression(n) {
            inc('JoinCollectionExpression');
            visitCollection(n.left);
            visitCollection(n.right);
        },
        visitInputPathCollection(n) {
            inc('InputPathCollection');
            visitNode(n.identifier, visitor);
        },
        visitSubqueryCollection(n) {
            inc('SubqueryCollection');
            visitNode(n.query, visitor);
        },
        visitLiteralScalarExpression(_n) {
            inc('LiteralScalarExpression');
        },
        visitPropertyRefScalarExpression(n) {
            inc('PropertyRefScalarExpression');
            if (n.member) visitScalar(n.member);
            visitNode(n.identifier, visitor);
        },
        visitParameterRefScalarExpression(n) {
            inc('ParameterRefScalarExpression');
            visitNode(n.parameter, visitor);
        },
        visitBinaryScalarExpression(n) {
            inc('BinaryScalarExpression');
            visitScalar(n.left);
            visitScalar(n.right);
        },
        visitUnaryScalarExpression(n) {
            inc('UnaryScalarExpression');
            visitScalar(n.operand);
        },
        visitConditionalScalarExpression(n) {
            inc('ConditionalScalarExpression');
            visitScalar(n.condition);
            visitScalar(n.consequent);
            visitScalar(n.alternate);
        },
        visitCoalesceScalarExpression(n) {
            inc('CoalesceScalarExpression');
            visitScalar(n.left);
            visitScalar(n.right);
        },
        visitBetweenScalarExpression(n) {
            inc('BetweenScalarExpression');
            visitScalar(n.expression);
            visitScalar(n.low);
            visitScalar(n.high);
        },
        visitInScalarExpression(n) {
            inc('InScalarExpression');
            visitScalar(n.expression);
            for (const item of n.items) visitScalar(item);
        },
        visitLikeScalarExpression(n) {
            inc('LikeScalarExpression');
            visitScalar(n.expression);
            visitScalar(n.pattern);
        },
        visitLetScalarExpression(n) {
            inc('LetScalarExpression');
            visitNode(n.identifier, visitor);
            visitScalar(n.value);
            visitScalar(n.body);
        },
        visitFunctionCallScalarExpression(n) {
            inc('FunctionCallScalarExpression');
            visitNode(n.name, visitor);
            for (const a of n.args) visitScalar(a);
        },
        visitExistsScalarExpression(n) {
            inc('ExistsScalarExpression');
            visitNode(n.subquery, visitor);
        },
        visitArrayScalarExpression(n) {
            inc('ArrayScalarExpression');
            visitNode(n.subquery, visitor);
        },
        visitFirstScalarExpression(n) {
            inc('FirstScalarExpression');
            visitNode(n.subquery, visitor);
        },
        visitLastScalarExpression(n) {
            inc('LastScalarExpression');
            visitNode(n.subquery, visitor);
        },
        visitSubqueryScalarExpression(n) {
            inc('SubqueryScalarExpression');
            visitNode(n.query, visitor);
        },
        visitMemberIndexerScalarExpression(n) {
            inc('MemberIndexerScalarExpression');
            visitScalar(n.member);
            visitScalar(n.indexer);
        },
        visitArrayCreateScalarExpression(n) {
            inc('ArrayCreateScalarExpression');
            for (const item of n.items) visitScalar(item);
        },
        visitObjectCreateScalarExpression(n) {
            inc('ObjectCreateScalarExpression');
            for (const p of n.properties) {
                visitNode(p.name, visitor);
                visitScalar(p.value);
            }
        },
        visitIdentifier() {
            inc('Identifier');
        },
        visitParameter() {
            inc('Parameter');
        },
    };

    function visitScalar(expr: AST.SqlScalarExpression) {
        visitNode(expr, visitor);
    }

    function visitCollection(col: AST.SqlCollectionExpression | AST.SqlCollection) {
        visitNode(col as AST.SqlNode, visitor);
    }

    return { visitor, counts };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SqlVisitor — visitNode dispatch', () => {
    it('visits all nodes in SELECT * FROM c', () => {
        const { ast } = parse('SELECT * FROM c');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['Program']).toBe(1);
        expect(counts['Query']).toBe(1);
        expect(counts['SelectClause']).toBe(1);
        expect(counts['SelectStarSpec']).toBe(1);
        expect(counts['FromClause']).toBe(1);
        expect(counts['AliasedCollectionExpression']).toBe(1);
        expect(counts['InputPathCollection']).toBe(1);
        expect(counts['Identifier']).toBe(1); // "c"
    });

    it('visits select list items in SELECT c.id, c.name FROM c', () => {
        const { ast } = parse('SELECT c.id, c.name FROM c');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['SelectListSpec']).toBe(1);
        expect(counts['SelectItem']).toBe(2);
        expect(counts['PropertyRefScalarExpression']).toBe(4); // c.id → c, id; c.name → c, name
        // Identifiers: c (×2 for props), id, name, c (from collection) = 5
        expect(counts['Identifier']).toBe(5);
    });

    it('visits WHERE clause binary expression', () => {
        const { ast } = parse('SELECT * FROM c WHERE c.age > 21');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['WhereClause']).toBe(1);
        expect(counts['BinaryScalarExpression']).toBe(1);
        expect(counts['LiteralScalarExpression']).toBe(1); // 21
    });

    it('visits ORDER BY items', () => {
        const { ast } = parse('SELECT * FROM c ORDER BY c.name ASC, c.age DESC');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['OrderByClause']).toBe(1);
        expect(counts['OrderByItem']).toBe(2);
    });

    it('visits OFFSET / LIMIT', () => {
        const { ast } = parse('SELECT * FROM c OFFSET 5 LIMIT 10');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['OffsetLimitClause']).toBe(1);
        expect(counts['LiteralScalarExpression']).toBe(2); // 5 and 10
    });

    it('visits GROUP BY expressions', () => {
        const { ast } = parse('SELECT c.type, COUNT(1) FROM c GROUP BY c.type');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['GroupByClause']).toBe(1);
        expect(counts['FunctionCallScalarExpression']).toBe(1); // COUNT
    });

    it('visits function call with arguments', () => {
        const { ast } = parse('SELECT ARRAY_LENGTH(c.tags) FROM c');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['FunctionCallScalarExpression']).toBe(1);
        // function name Identifier + c.tags (c, tags) + collection c
        expect(counts['Identifier']).toBeGreaterThanOrEqual(4);
    });

    it('visits SELECT VALUE expression', () => {
        const { ast } = parse('SELECT VALUE c.id FROM c');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['SelectValueSpec']).toBe(1);
        expect(counts['PropertyRefScalarExpression']).toBe(2); // c.id → c, id
    });

    it('visits TOP spec', () => {
        const { ast } = parse('SELECT TOP 5 * FROM c');
        expect(ast).toBeDefined();
        const { visitor, counts } = createCountingVisitor();
        visitNode(ast!, visitor);

        expect(counts['TopSpec']).toBe(1);
        expect(counts['SelectStarSpec']).toBe(1);
    });
});

describe('SqlVisitor — visitNode throws on unknown kind', () => {
    it('throws for unrecognized node kind', () => {
        const { visitor } = createCountingVisitor();
        const bogus = { kind: 'BogusNode', range: undefined } as any;
        expect(() => visitNode(bogus, visitor)).toThrow('Unknown node kind: BogusNode');
    });
});

describe('SqlVisitor — deterministic traversal', () => {
    it('visiting the same AST twice yields identical counts', () => {
        const { ast } = parse('SELECT c.id, c.name FROM c WHERE c.age > 21 ORDER BY c.name ASC');
        expect(ast).toBeDefined();

        const { visitor: v1, counts: c1 } = createCountingVisitor();
        visitNode(ast!, v1);

        const { visitor: v2, counts: c2 } = createCountingVisitor();
        visitNode(ast!, v2);

        expect(c1).toEqual(c2);
    });
});
