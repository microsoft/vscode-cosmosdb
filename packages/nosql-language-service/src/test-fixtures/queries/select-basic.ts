/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { QueryFixture } from './types.js';

export const fixtures: QueryFixture[] = [
    // ── S series: basic SELECT ──────────────────────────────────────────────
    {
        id: 'S-01',
        description: 'SELECT * — star',
        query: 'SELECT * FROM c',
        container: 'products',
        expectAst: { select: { spec: { kind: 'SelectStarSpec' } }, from: { collection: { kind: 'AliasedCollectionExpression' } } },
    },
    {
        id: 'S-02',
        description: 'SELECT list — three items',
        query: 'SELECT c.id, c.name, c.price FROM c',
        container: 'products',
        expectAst: { select: { spec: { kind: 'SelectListSpec' } } },
    },
    {
        id: 'S-03',
        description: 'SELECT VALUE — scalar projection',
        query: 'SELECT VALUE c.price FROM c',
        container: 'products',
        expectAst: { select: { spec: { kind: 'SelectValueSpec' } } },
    },
    {
        id: 'S-04',
        description: 'SELECT DISTINCT',
        query: 'SELECT DISTINCT c.category FROM c',
        container: 'products',
        expectAst: { select: { distinct: true, spec: { kind: 'SelectListSpec' } } },
    },
    {
        id: 'S-05',
        description: 'SELECT TOP 5 — numeric literal',
        query: 'SELECT TOP 5 * FROM c',
        container: 'products',
        expectAst: { select: { top: { kind: 'TopSpec' }, spec: { kind: 'SelectStarSpec' } } },
    },
    {
        id: 'S-06',
        description: 'SELECT TOP @n — parameter ref',
        query: 'SELECT TOP @n * FROM c',
        container: 'products',
        expectAst: { select: { top: { value: { kind: 'ParameterRefScalarExpression' } } } },
    },
    {
        id: 'S-07',
        description: 'Bracket notation c["name"]',
        query: 'SELECT c.id, c["name"] FROM c',
        container: 'products',
        expectAst: { select: { spec: { kind: 'SelectListSpec' } } },
    },
    {
        id: 'S-08',
        description: 'Object literal in SELECT',
        query: 'SELECT {"id": c.id, "label": c.name} FROM c',
        container: 'products',
        expectAst: { select: { spec: { kind: 'SelectListSpec' } } },
    },
    {
        id: 'S-09',
        description: 'Array literal in SELECT',
        query: 'SELECT [c.price, c.rating] FROM c',
        container: 'products',
        expectAst: { select: { spec: { kind: 'SelectListSpec' } } },
    },
    {
        id: 'S-10',
        description: 'SELECT DISTINCT TOP 3 — both modifiers',
        query: 'SELECT DISTINCT TOP 3 c.category FROM c',
        container: 'products',
        expectAst: { select: { distinct: true, top: { kind: 'TopSpec' } } },
    },

    // ── F series: FROM and aliases ──────────────────────────────────────────
    {
        id: 'F-01',
        description: 'FROM with alias (implicit)',
        query: 'SELECT * FROM Products p',
        container: 'products',
        expectAst: { from: { collection: { kind: 'AliasedCollectionExpression' } } },
    },
    {
        id: 'F-02',
        description: 'FROM with AS keyword alias',
        query: 'SELECT p.name FROM Products AS p',
        container: 'products',
        expectAst: { from: { collection: { kind: 'AliasedCollectionExpression' } } },
    },
    {
        id: 'F-03',
        description: 'FROM subquery',
        query: 'SELECT * FROM (SELECT c.id, c.price FROM c WHERE c.inStock = true) sub',
        container: 'products',
        expectAst: { from: { collection: { kind: 'AliasedCollectionExpression', collection: { kind: 'SubqueryCollection' } } } },
    },
];
