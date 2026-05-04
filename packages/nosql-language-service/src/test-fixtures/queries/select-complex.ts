/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { QueryFixture } from './types.js';

export const fixtures: QueryFixture[] = [
    // ── SQ series: scalar subqueries — ARRAY, FIRST, LAST ──────────────────
    {
        id: 'SQ-01',
        description: 'ARRAY subquery in SELECT',
        query: 'SELECT c.id, ARRAY(SELECT VALUE i.name FROM i IN c.items) AS itemNames FROM c',
        container: 'orders',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        { expression: { kind: 'ArrayScalarExpression' }, alias: { value: 'itemNames' } },
                    ],
                },
            },
        },
    },
    {
        id: 'SQ-02',
        description: 'FIRST subquery — most expensive item',
        query: 'SELECT c.id, FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.unitPrice DESC) AS mostExpensive FROM c',
        container: 'orders',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        { expression: { kind: 'FirstScalarExpression' }, alias: { value: 'mostExpensive' } },
                    ],
                },
            },
        },
        knownLimitation: 'FIRST() subquery is not supported in the vnext-preview Linux emulator',
    },
    {
        id: 'SQ-03',
        description: 'LAST subquery — last item in array',
        query: 'SELECT c.id, LAST(SELECT VALUE i FROM i IN c.items) AS lastItem FROM c',
        container: 'orders',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        { expression: { kind: 'LastScalarExpression' }, alias: { value: 'lastItem' } },
                    ],
                },
            },
        },
    },
    {
        id: 'SQ-04',
        description: 'Scalar subquery COUNT',
        query: 'SELECT c.id, (SELECT VALUE COUNT(1) FROM i IN c.items) AS itemCount FROM c',
        container: 'orders',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        { expression: { kind: 'SubqueryScalarExpression' }, alias: { value: 'itemCount' } },
                    ],
                },
            },
        },
    },

    // ── OP series: operators ────────────────────────────────────────────────
    {
        id: 'OP-01',
        description: 'Multiply — price inflator',
        query: 'SELECT c.price * 1.2 AS inflated FROM c',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'BinaryScalarExpression', operator: 'Multiply' },
                            alias: { value: 'inflated' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'OP-02',
        description: 'Coalesce ?? — null-safe discount',
        query: 'SELECT c.discount ?? 0 AS effectiveDiscount FROM c',
        container: 'orders',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'CoalesceScalarExpression' },
                            alias: { value: 'effectiveDiscount' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'OP-03',
        description: 'Ternary conditional (? :)',
        query: 'SELECT (c.price > 100 ? "expensive" : "affordable") AS priceLabel FROM c',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'ConditionalScalarExpression' },
                            alias: { value: 'priceLabel' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'OP-04',
        description: 'Divide — half price',
        query: 'SELECT c.price / 2 AS half FROM c',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'BinaryScalarExpression', operator: 'Divide' },
                            alias: { value: 'half' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'OP-05',
        description: 'Modulo — amount mod 100',
        query: 'SELECT c.totalAmount % 100 FROM c',
        container: 'orders',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'BinaryScalarExpression', operator: 'Modulo' } }],
                },
            },
        },
    },
    {
        id: 'OP-06',
        description: 'Bitwise AND (&) with decimal literal',
        query: 'SELECT c.durationMs & 15 FROM c',
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'BinaryScalarExpression', operator: 'BitwiseAnd' } }],
                },
            },
        },
    },
    {
        id: 'OP-07',
        description: 'Bitwise NOT (~) unary',
        query: 'SELECT ~c.durationMs FROM c',
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'UnaryScalarExpression', operator: 'BitwiseNot' } }],
                },
            },
        },
    },
    {
        id: 'OP-08',
        description: 'Bitwise OR (|)',
        query: 'SELECT c.durationMs | 256 FROM c',
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'BinaryScalarExpression', operator: 'BitwiseOr' } }],
                },
            },
        },
    },
    {
        id: 'OP-09',
        description: 'Bitwise XOR (^)',
        query: 'SELECT c.durationMs ^ 255 FROM c',
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'BinaryScalarExpression', operator: 'BitwiseXor' } }],
                },
            },
        },
    },
    {
        id: 'OP-10',
        description: 'Bitwise left shift (<<)',
        query: 'SELECT c.durationMs << 2 FROM c',
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'BinaryScalarExpression', operator: 'LeftShift' } }],
                },
            },
        },
    },
    {
        id: 'OP-11',
        description: 'Bitwise right shift (>>)',
        query: 'SELECT c.durationMs >> 1 FROM c',
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'BinaryScalarExpression', operator: 'RightShift' } }],
                },
            },
        },
    },
    {
        id: 'OP-12',
        description: 'Unary minus negation',
        query: 'SELECT -(c.price) FROM c',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'UnaryScalarExpression', operator: 'Minus' } }],
                },
            },
        },
    },
    {
        id: 'OP-13',
        description: 'Coalesce with expression fallback',
        query: 'SELECT c.discount ?? c.totalAmount * 0.05 FROM c',
        container: 'orders',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'CoalesceScalarExpression' } }],
                },
            },
        },
    },

    // ── PR series: parameters ───────────────────────────────────────────────
    {
        id: 'PR-01',
        description: 'ParameterRef in WHERE — single param',
        query: 'SELECT * FROM c WHERE c.category = @category',
        container: 'products',
        expectAst: {
            where: {
                expression: {
                    kind: 'BinaryScalarExpression',
                    right: { kind: 'ParameterRefScalarExpression', parameter: { name: '@category' } },
                },
            },
        },
    },
    {
        id: 'PR-02',
        description: 'ParameterRef in BETWEEN — two params',
        query: 'SELECT * FROM c WHERE c.price BETWEEN @minPrice AND @maxPrice',
        container: 'products',
        expectAst: {
            where: {
                expression: {
                    kind: 'BetweenScalarExpression',
                    low: { kind: 'ParameterRefScalarExpression', parameter: { name: '@minPrice' } },
                    high: { kind: 'ParameterRefScalarExpression', parameter: { name: '@maxPrice' } },
                },
            },
        },
    },
    {
        id: 'PR-03',
        description: 'Multiple parameters throughout query',
        query: 'SELECT TOP @topN * FROM c WHERE c.inStock = @inStock ORDER BY c.price DESC OFFSET @skip LIMIT @take',
        container: 'products',
        expectAst: {
            select: { top: { value: { kind: 'ParameterRefScalarExpression', parameter: { name: '@topN' } } } },
            orderBy: { items: [{ sortOrder: 'Descending' }] },
            offsetLimit: {
                offset: { value: { kind: 'ParameterRefScalarExpression' } },
                limit: { value: { kind: 'ParameterRefScalarExpression' } },
            },
        },
    },

    // ── UDF series: user-defined function calls ─────────────────────────────
    {
        id: 'UDF-01',
        description: 'UDF call in SELECT — udf flag must be true',
        query: 'SELECT udf.formatPrice(c.price) FROM c',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: {
                                kind: 'FunctionCallScalarExpression',
                                udf: true,
                                name: { value: 'formatPrice' },
                            },
                        },
                    ],
                },
            },
        },
        knownLimitation: 'UDF not registered in the emulator — runtime 400 expected',
    },
    {
        id: 'UDF-02',
        description: 'UDF call in WHERE',
        query: 'SELECT * FROM c WHERE udf.isExpensive(c.price, 100)',
        container: 'products',
        expectAst: {
            where: {
                expression: {
                    kind: 'FunctionCallScalarExpression',
                    udf: true,
                    name: { value: 'isExpensive' },
                },
            },
        },
        knownLimitation: 'UDF not registered in the emulator — runtime 400 expected',
    },
    {
        id: 'UDF-03',
        description: 'UDF call with multiple args + alias',
        query: 'SELECT udf.categoryLabel(c.category, c.brand, c.inStock) AS label FROM c',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: {
                                kind: 'FunctionCallScalarExpression',
                                udf: true,
                                name: { value: 'categoryLabel' },
                            },
                            alias: { value: 'label' },
                        },
                    ],
                },
            },
        },
        knownLimitation: 'UDF not registered in the emulator — runtime 400 expected',
    },

    // ── CX series: complex / compositional ─────────────────────────────────
    {
        id: 'CX-01',
        description: 'DISTINCT + WHERE combined',
        query: 'SELECT DISTINCT c.category FROM c WHERE c.inStock = true',
        container: 'products',
        expectAst: {
            select: { distinct: true, spec: { kind: 'SelectListSpec' } },
            where: { expression: { kind: 'BinaryScalarExpression', operator: 'Equal' } },
        },
    },
    {
        id: 'CX-02',
        description: 'TOP + WHERE multi-condition + ORDER BY',
        query: `SELECT TOP 5 c.name, c.price FROM c WHERE c.category = 'Electronics' AND c.rating > 4 ORDER BY c.price DESC`,
        container: 'products',
        expectAst: {
            select: { top: { kind: 'TopSpec' }, spec: { kind: 'SelectListSpec' } },
            where: { expression: { kind: 'BinaryScalarExpression', operator: 'And' } },
            orderBy: { items: [{ sortOrder: 'Descending' }] },
        },
    },
    {
        id: 'CX-03',
        description: 'WHERE + GROUP BY + aggregate',
        query: `SELECT c.customerId, SUM(c.totalAmount) AS spent FROM c WHERE c.status != 'cancelled' GROUP BY c.customerId`,
        container: 'orders',
        expectAst: {
            where: { expression: { kind: 'BinaryScalarExpression', operator: 'NotEqual' } },
            groupBy: { kind: 'GroupByClause' },
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'SUM' } },
                            alias: { value: 'spent' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'CX-04',
        description: 'Nested ARRAY subquery with function filter',
        query: `SELECT c.id, c.name, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE STARTSWITH(t, 'w')) AS wTags FROM c WHERE ARRAY_LENGTH(c.tags) > 0`,
        container: 'products',
        expectAst: {
            where: { expression: { kind: 'BinaryScalarExpression', operator: 'GreaterThan' } },
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {},
                        { expression: { kind: 'ArrayScalarExpression' }, alias: { value: 'wTags' } },
                    ],
                },
            },
        },
    },
    {
        id: 'CX-05',
        description: 'EXISTS + GROUP BY — orders with expensive items',
        query: `SELECT c.customerId, COUNT(1) AS cnt FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.unitPrice > 100) GROUP BY c.customerId`,
        container: 'orders',
        expectAst: {
            where: { expression: { kind: 'ExistsScalarExpression' } },
            groupBy: { kind: 'GroupByClause' },
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{}, { alias: { value: 'cnt' } }],
                },
            },
        },
    },
    {
        id: 'CX-06',
        description: 'Full query: WHERE BETWEEN(parens) + GROUP BY + ORDER BY + OFFSET LIMIT',
        // NOTE: BETWEEN must be wrapped in parentheses when combined with GROUP BY/ORDER BY
        // because isBetweenExpressionAhead() scans forward past clause boundaries.
        query:
            `SELECT c.type, c.userId, COUNT(1) AS cnt FROM c` +
            ` WHERE (c.timestamp BETWEEN @from AND @to)` +
            ` GROUP BY c.type, c.userId` +
            ` ORDER BY c.type DESC` +
            ` OFFSET 0 LIMIT 20`,
        container: 'events',
        expectAst: {
            where: { expression: { kind: 'BetweenScalarExpression' } },
            groupBy: { expressions: [{}, {}] },
            orderBy: { items: [{ sortOrder: 'Descending' }] },
            offsetLimit: { kind: 'OffsetLimitClause' },
        },
    },
    {
        id: 'CX-07',
        description: 'Chained ternary in SELECT',
        query: `SELECT c.id, (c.status = 'delivered' ? 'done' : c.status = 'cancelled' ? 'failed' : 'active') AS state FROM c`,
        container: 'orders',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {
                            expression: { kind: 'ConditionalScalarExpression' },
                            alias: { value: 'state' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'CX-08',
        description: 'CONTAINS with case-insensitive flag',
        query: `SELECT * FROM c WHERE CONTAINS(c.name, 'phone', true)`,
        container: 'products',
        expectAst: {
            where: {
                expression: {
                    kind: 'FunctionCallScalarExpression',
                    name: { value: 'CONTAINS' },
                    udf: false,
                },
            },
        },
    },
];
