/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { QueryFixture } from './types.js';

export const fixtures: QueryFixture[] = [
    // ── J series: JOIN and array iterators ─────────────────────────────────
    {
        id: 'J-01',
        description: 'JOIN t IN c.tags — array iterator',
        query: 'SELECT c.id, t FROM c JOIN t IN c.tags',
        container: 'products',
        expectAst: { from: { collection: { kind: 'JoinCollectionExpression' } } },
    },
    {
        id: 'J-02',
        description: 'JOIN item IN c.items — nested array',
        query: 'SELECT c.id, item.name FROM c JOIN item IN c.items',
        container: 'orders',
        expectAst: { from: { collection: { kind: 'JoinCollectionExpression' } } },
    },
    {
        id: 'J-03',
        description: 'JOIN with WHERE on iterator variable',
        query: 'SELECT c.id, item.name FROM c JOIN item IN c.items WHERE item.quantity > 2',
        container: 'orders',
        expectAst: {
            from: { collection: { kind: 'JoinCollectionExpression' } },
            where: { expression: { kind: 'BinaryScalarExpression' } },
        },
    },
    {
        id: 'J-04',
        description: 'Double JOIN — two array iterators',
        query: 'SELECT c.id, t1, t2 FROM c JOIN t1 IN c.tags JOIN t2 IN c.tags',
        container: 'products',
        expectAst: { from: { collection: { kind: 'JoinCollectionExpression' } } },
    },
    {
        id: 'J-05',
        description: 'SELECT VALUE with JOIN',
        query: `SELECT VALUE t FROM c JOIN t IN c.tags WHERE t = 'sale'`,
        container: 'products',
        expectAst: {
            select: { spec: { kind: 'SelectValueSpec' } },
            from: { collection: { kind: 'JoinCollectionExpression' } },
        },
    },
];
