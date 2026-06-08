/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QueryFixture } from './types.js';

export const fixtures: QueryFixture[] = [
    // ── W series: WHERE comparisons ────────────────────────────────────────
    {
        id: 'W-01',
        description: 'WHERE = (equal)',
        query: 'SELECT * FROM c WHERE c.price = 29.99',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'Equal' } } },
    },
    {
        id: 'W-02',
        description: 'WHERE != (not equal)',
        query: 'SELECT * FROM c WHERE c.price != 0',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'NotEqual' } } },
    },
    {
        id: 'W-03',
        description: 'WHERE > (greater than)',
        query: 'SELECT * FROM c WHERE c.price > 100',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'GreaterThan' } } },
    },
    {
        id: 'W-04',
        description: 'WHERE >= (greater than or equal)',
        query: 'SELECT * FROM c WHERE c.price >= 100',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'GreaterThanOrEqual' } } },
    },
    {
        id: 'W-05',
        description: 'WHERE < (less than)',
        query: 'SELECT * FROM c WHERE c.price < 10',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'LessThan' } } },
    },
    {
        id: 'W-06',
        description: 'WHERE <= (less than or equal)',
        query: 'SELECT * FROM c WHERE c.price <= 10',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'LessThanOrEqual' } } },
    },
    {
        id: 'W-07',
        description: 'WHERE = true (boolean literal)',
        query: 'SELECT * FROM c WHERE c.inStock = true',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'Equal' } } },
    },
    {
        id: 'W-08',
        description: 'WHERE = false',
        query: 'SELECT * FROM c WHERE c.inStock = false',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'Equal' } } },
    },
    {
        id: 'W-09',
        description: 'WHERE = null',
        query: 'SELECT * FROM c WHERE c.rating = null',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'Equal' } } },
    },
    {
        id: 'W-10',
        description: 'WHERE AND compound',
        query: 'SELECT * FROM c WHERE c.price > 10 AND c.price < 100',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'And' } } },
    },
    {
        id: 'W-11',
        description: 'WHERE OR',
        query: `SELECT * FROM c WHERE c.category = 'Books' OR c.category = 'Food'`,
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'Or' } } },
    },
    {
        id: 'W-12',
        description: 'WHERE NOT (unary)',
        query: 'SELECT * FROM c WHERE NOT c.inStock',
        container: 'products',
        expectAst: { where: { expression: { kind: 'UnaryScalarExpression', operator: 'Not' } } },
    },
    {
        id: 'W-13',
        description: 'WHERE NOT on grouped AND expression',
        query: 'SELECT * FROM c WHERE NOT (c.price > 100 AND c.inStock = false)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'UnaryScalarExpression', operator: 'Not' } } },
    },

    // ── B series: BETWEEN, IN, LIKE ────────────────────────────────────────
    //
    // NOTE: when combining BETWEEN with logical AND, parentheses are required:
    //   (c.price BETWEEN 10 AND 100) AND other
    // Without parens the parser greedily consumes the second AND as the BETWEEN
    // separator, matching native C++ sql.y behavior. See betweenAmbiguity.ts.
    //
    {
        id: 'B-01',
        description: 'BETWEEN — standalone',
        query: 'SELECT * FROM c WHERE c.price BETWEEN 10 AND 50',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BetweenScalarExpression', not: false } } },
    },
    {
        id: 'B-02',
        description: 'NOT BETWEEN',
        query: 'SELECT * FROM c WHERE c.price NOT BETWEEN 10 AND 50',
        container: 'products',
        expectAst: { where: { expression: { kind: 'BetweenScalarExpression', not: true } } },
    },
    {
        id: 'B-03',
        description: 'IN list',
        query: `SELECT * FROM c WHERE c.category IN ('Electronics', 'Books')`,
        container: 'products',
        expectAst: { where: { expression: { kind: 'InScalarExpression', not: false } } },
    },
    {
        id: 'B-04',
        description: 'NOT IN list',
        query: `SELECT * FROM c WHERE c.category NOT IN ('Food')`,
        container: 'products',
        expectAst: { where: { expression: { kind: 'InScalarExpression', not: true } } },
    },
    {
        id: 'B-05',
        description: 'LIKE — contains pattern',
        query: `SELECT * FROM c WHERE c.name LIKE '%Headphone%'`,
        container: 'products',
        expectAst: { where: { expression: { kind: 'LikeScalarExpression', not: false } } },
    },
    {
        id: 'B-06',
        description: 'LIKE — prefix pattern',
        query: `SELECT * FROM c WHERE c.name LIKE 'Wireless%'`,
        container: 'products',
        expectAst: { where: { expression: { kind: 'LikeScalarExpression' } } },
    },
    {
        id: 'B-07',
        description: 'NOT LIKE',
        query: `SELECT * FROM c WHERE c.name NOT LIKE '%Cheap%'`,
        container: 'products',
        expectAst: { where: { expression: { kind: 'LikeScalarExpression', not: true } } },
    },
    {
        id: 'B-08',
        description: 'BETWEEN + IN combined (parentheses required around BETWEEN)',
        query: `SELECT * FROM c WHERE (c.price BETWEEN 10 AND 100) AND c.category IN ('Electronics', 'Clothing')`,
        container: 'products',
        expectAst: {
            where: {
                expression: {
                    kind: 'BinaryScalarExpression',
                    operator: 'And',
                    left: { kind: 'BetweenScalarExpression' },
                    right: { kind: 'InScalarExpression' },
                },
            },
        },
    },
    {
        id: 'B-09',
        description: 'BETWEEN with parameter refs as bounds',
        query: 'SELECT * FROM c WHERE c.price BETWEEN @min AND @max',
        container: 'products',
        expectAst: {
            where: {
                expression: {
                    kind: 'BetweenScalarExpression',
                    low: { kind: 'ParameterRefScalarExpression' },
                    high: { kind: 'ParameterRefScalarExpression' },
                },
            },
        },
    },

    // ── T series: type-checking functions ──────────────────────────────────
    // NOTE: FunctionCallScalarExpression.name is an Identifier node { kind, value },
    // not a plain string. Use { name: { value: 'FUNC_NAME' } } in expectAst.
    {
        id: 'T-01',
        description: 'IS_NULL',
        query: 'SELECT * FROM c WHERE IS_NULL(c.rating)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IS_NULL' } } } },
    },
    {
        id: 'T-02',
        description: 'IS_DEFINED',
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.brand)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IS_DEFINED' } } } },
    },
    {
        id: 'T-03',
        description: 'NOT IS_DEFINED (missing field)',
        query: 'SELECT * FROM c WHERE NOT IS_DEFINED(c.brand)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'UnaryScalarExpression', operator: 'Not' } } },
    },
    {
        id: 'T-04',
        description: 'IS_STRING',
        query: 'SELECT * FROM c WHERE IS_STRING(c.name)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IS_STRING' } } } },
    },
    {
        id: 'T-05',
        description: 'IS_NUMBER',
        query: 'SELECT * FROM c WHERE IS_NUMBER(c.price)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IS_NUMBER' } } } },
    },
    {
        id: 'T-06',
        description: 'IS_BOOL',
        query: 'SELECT * FROM c WHERE IS_BOOL(c.inStock)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IS_BOOL' } } } },
    },
    {
        id: 'T-07',
        description: 'IS_ARRAY',
        query: 'SELECT * FROM c WHERE IS_ARRAY(c.tags)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IS_ARRAY' } } } },
    },
    {
        id: 'T-08',
        description: 'IS_OBJECT',
        query: 'SELECT * FROM c WHERE IS_OBJECT(c.shipping)',
        container: 'orders',
        expectAst: { where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IS_OBJECT' } } } },
    },
    {
        id: 'T-09',
        description: 'IS_PRIMITIVE',
        query: 'SELECT * FROM c WHERE IS_PRIMITIVE(c.price)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IS_PRIMITIVE' } } } },
    },

    // ── E series: EXISTS subquery ───────────────────────────────────────────
    {
        id: 'E-01',
        description: 'EXISTS correlated subquery over tags',
        query: `SELECT c.id FROM c WHERE EXISTS(SELECT VALUE t FROM t IN c.tags WHERE t = 'sale')`,
        container: 'products',
        expectAst: { where: { expression: { kind: 'ExistsScalarExpression' } } },
    },
    {
        id: 'E-02',
        description: 'EXISTS over nested array with quantity filter',
        query: 'SELECT c.id FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.quantity > 5)',
        container: 'orders',
        expectAst: { where: { expression: { kind: 'ExistsScalarExpression' } } },
    },
    {
        id: 'E-03',
        description: 'NOT EXISTS',
        query: 'SELECT c.id FROM c WHERE NOT EXISTS(SELECT VALUE t FROM t IN c.tags)',
        container: 'products',
        expectAst: { where: { expression: { kind: 'UnaryScalarExpression', operator: 'Not' } } },
    },
];
