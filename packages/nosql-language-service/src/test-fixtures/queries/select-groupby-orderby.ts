/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { QueryFixture } from './types.js';

export const fixtures: QueryFixture[] = [
    // ── O series: ORDER BY ──────────────────────────────────────────────────
    {
        id: 'O-01',
        description: 'ORDER BY — default (no explicit direction)',
        query: 'SELECT * FROM c ORDER BY c.price',
        container: 'products',
        expectAst: {
            orderBy: { kind: 'OrderByClause', items: [{ kind: 'OrderByItem', sortOrder: 'None' }] },
        },
    },
    {
        id: 'O-02',
        description: 'ORDER BY ASC — explicit ascending',
        query: 'SELECT * FROM c ORDER BY c.price ASC',
        container: 'products',
        expectAst: {
            orderBy: { items: [{ sortOrder: 'Ascending' }] },
        },
    },
    {
        id: 'O-03',
        description: 'ORDER BY DESC',
        query: 'SELECT * FROM c ORDER BY c.price DESC',
        container: 'products',
        expectAst: {
            orderBy: { items: [{ sortOrder: 'Descending' }] },
        },
    },
    {
        id: 'O-04',
        description: 'ORDER BY two columns ASC + DESC',
        query: 'SELECT * FROM c ORDER BY c.category ASC, c.price DESC',
        container: 'products',
        expectAst: {
            orderBy: {
                items: [{ sortOrder: 'Ascending' }, { sortOrder: 'Descending' }],
            },
        },
    },
    {
        id: 'O-05',
        description: 'ORDER BY three columns',
        query: 'SELECT * FROM c ORDER BY c.rating DESC, c.name ASC, c.id ASC',
        container: 'products',
        expectAst: {
            orderBy: {
                items: [{ sortOrder: 'Descending' }, { sortOrder: 'Ascending' }, { sortOrder: 'Ascending' }],
            },
        },
    },
    {
        id: 'O-06',
        description: 'ORDER BY nested path',
        query: 'SELECT * FROM c ORDER BY c.shipping.address.city ASC',
        container: 'orders',
        expectAst: {
            orderBy: { items: [{ sortOrder: 'Ascending' }] },
        },
    },

    // ── G series: GROUP BY + aggregations ──────────────────────────────────
    {
        id: 'G-01',
        description: 'GROUP BY + COUNT(1) AS cnt — named aggregate',
        query: 'SELECT c.category, COUNT(1) AS cnt FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        { expression: { kind: 'PropertyRefScalarExpression' } },
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'COUNT' } },
                            alias: { value: 'cnt' },
                        },
                    ],
                },
            },
            groupBy: { kind: 'GroupByClause' },
        },
    },
    {
        id: 'G-01b',
        description: 'GROUP BY + COUNT(1) — unnamed aggregate (no alias)',
        query: 'SELECT c.category, COUNT(1) FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        { expression: { kind: 'PropertyRefScalarExpression' } },
                        { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'COUNT' } } },
                    ],
                },
            },
            groupBy: { kind: 'GroupByClause' },
        },
    },
    {
        id: 'G-02',
        description: 'GROUP BY + SUM AS total — named aggregate',
        query: 'SELECT c.category, SUM(c.price) AS total FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'SUM' } },
                            alias: { value: 'total' },
                        },
                    ],
                },
            },
            groupBy: { kind: 'GroupByClause' },
        },
    },
    {
        id: 'G-02b',
        description: 'GROUP BY + SUM — unnamed aggregate',
        query: 'SELECT c.category, SUM(c.price) FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{}, { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'SUM' } } }],
                },
            },
            groupBy: { kind: 'GroupByClause' },
        },
    },
    {
        id: 'G-03',
        description: 'GROUP BY + AVG AS avgRating',
        query: 'SELECT c.category, AVG(c.rating) AS avgRating FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'AVG' } },
                            alias: { value: 'avgRating' },
                        },
                    ],
                },
            },
            groupBy: { kind: 'GroupByClause' },
        },
    },
    {
        id: 'G-04',
        description: 'GROUP BY + MIN + MAX together',
        query: 'SELECT c.category, MIN(c.price) AS minPrice, MAX(c.price) AS maxPrice FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'MIN' } },
                            alias: { value: 'minPrice' },
                        },
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'MAX' } },
                            alias: { value: 'maxPrice' },
                        },
                    ],
                },
            },
            groupBy: { kind: 'GroupByClause' },
        },
    },
    {
        id: 'G-05',
        description: 'GROUP BY two columns',
        query: 'SELECT c.category, c.inStock, COUNT(1) FROM c GROUP BY c.category, c.inStock',
        container: 'products',
        expectAst: {
            groupBy: { expressions: [{}, {}] },
        },
    },
    {
        id: 'G-06',
        description: 'GROUP BY status — orders container',
        query: 'SELECT c.status, COUNT(1) AS cnt FROM c GROUP BY c.status',
        container: 'orders',
        expectAst: {
            groupBy: { kind: 'GroupByClause' },
            select: { spec: { kind: 'SelectListSpec' } },
        },
    },
    {
        id: 'G-07',
        description: 'GROUP BY event type with AVG',
        query: 'SELECT c.type, COUNT(1) AS cnt, AVG(c.durationMs) AS avgMs FROM c GROUP BY c.type',
        container: 'events',
        expectAst: {
            groupBy: { kind: 'GroupByClause' },
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        { alias: { value: 'cnt' } },
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'AVG' } },
                            alias: { value: 'avgMs' },
                        },
                    ],
                },
            },
        },
    },

    // ── P series: OFFSET / LIMIT ────────────────────────────────────────────
    {
        id: 'P-01',
        description: 'OFFSET 0 LIMIT 10 — literals',
        query: 'SELECT * FROM c OFFSET 0 LIMIT 10',
        container: 'products',
        expectAst: {
            offsetLimit: {
                kind: 'OffsetLimitClause',
                offset: { kind: 'OffsetSpec', value: { kind: 'LiteralScalarExpression' } },
                limit: { kind: 'LimitSpec', value: { kind: 'LiteralScalarExpression' } },
            },
        },
    },
    {
        id: 'P-02',
        description: 'ORDER BY + OFFSET LIMIT',
        query: 'SELECT * FROM c ORDER BY c.price OFFSET 10 LIMIT 5',
        container: 'products',
        expectAst: {
            orderBy: { kind: 'OrderByClause' },
            offsetLimit: { kind: 'OffsetLimitClause' },
        },
    },
    {
        id: 'P-03',
        description: 'OFFSET @skip LIMIT @take — parameters',
        query: 'SELECT * FROM c OFFSET @skip LIMIT @take',
        container: 'products',
        expectAst: {
            offsetLimit: {
                offset: { value: { kind: 'ParameterRefScalarExpression' } },
                limit: { value: { kind: 'ParameterRefScalarExpression' } },
            },
        },
    },
    {
        id: 'P-04',
        description: '"Latest event" — ORDER BY DESC + OFFSET 0 LIMIT 1',
        query: 'SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT 1',
        container: 'events',
        expectAst: {
            orderBy: { items: [{ sortOrder: 'Descending' }] },
            offsetLimit: { kind: 'OffsetLimitClause' },
        },
    },

    // ── G-08..10: aggregate functions CountIf / MakeList / MakeSet ──────────
    {
        id: 'G-08',
        description: 'CountIf — count in-stock products per category',
        query: 'SELECT c.category, CountIf(c.inStock) AS inStockCount FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            groupBy: { kind: 'GroupByClause' },
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'CountIf' } },
                            alias: { value: 'inStockCount' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'G-09',
        description: 'MakeList — collect brand names per category (may include duplicates)',
        query: 'SELECT c.category, MakeList(c.brand) AS brands FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            groupBy: { kind: 'GroupByClause' },
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'MakeList' } },
                            alias: { value: 'brands' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'G-10',
        description: 'MakeSet — collect distinct brand names per category',
        query: 'SELECT c.category, MakeSet(c.brand) AS uniqueBrands FROM c GROUP BY c.category',
        container: 'products',
        expectAst: {
            groupBy: { kind: 'GroupByClause' },
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {},
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'MakeSet' } },
                            alias: { value: 'uniqueBrands' },
                        },
                    ],
                },
            },
        },
    },
];
