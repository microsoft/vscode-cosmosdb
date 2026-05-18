/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QueryFixture } from './types.js';

export const fixtures: QueryFixture[] = [
    // ── TC series: type conversion functions ────────────────────────────────

    // Use TOP 1 to keep the result set small; literals ensure no null surprises.
    {
        id: 'TC-01',
        description: 'StringToNumber converts numeric string literal',
        query: `SELECT TOP 1 StringToNumber('42') AS n FROM c`,
        container: 'products',
        expectAst: {
            select: {
                top: { kind: 'TopSpec' },
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'StringToNumber' } },
                            alias: { value: 'n' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'TC-02',
        description: 'StringToBoolean converts "true" literal',
        query: `SELECT TOP 1 StringToBoolean('true') AS b FROM c`,
        container: 'products',
        expectAst: {
            select: {
                top: { kind: 'TopSpec' },
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: {
                                kind: 'FunctionCallScalarExpression',
                                name: { value: 'StringToBoolean' },
                            },
                            alias: { value: 'b' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'TC-03',
        description: 'StringToNull converts "null" literal',
        query: `SELECT TOP 1 StringToNull('null') AS v FROM c`,
        container: 'products',
        expectAst: {
            select: {
                top: { kind: 'TopSpec' },
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'StringToNull' } },
                            alias: { value: 'v' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'TC-04',
        description: 'StringToArray converts JSON array string',
        query: `SELECT TOP 1 StringToArray('[1, 2, 3]') AS arr FROM c`,
        container: 'products',
        expectAst: {
            select: {
                top: { kind: 'TopSpec' },
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'StringToArray' } },
                            alias: { value: 'arr' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'TC-05',
        description: 'StringToObject converts JSON object string',
        query: `SELECT TOP 1 StringToObject('{"a": 1}') AS obj FROM c`,
        container: 'products',
        expectAst: {
            select: {
                top: { kind: 'TopSpec' },
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: {
                                kind: 'FunctionCallScalarExpression',
                                name: { value: 'StringToObject' },
                            },
                            alias: { value: 'obj' },
                        },
                    ],
                },
            },
        },
    },

    // ── CF series: conditional functions ────────────────────────────────────
    {
        id: 'CF-01',
        description: 'IIF in SELECT',
        query: `SELECT IIF(c.inStock, 'available', 'sold out') AS availability FROM c`,
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'IIF' } },
                            alias: { value: 'availability' },
                        },
                    ],
                },
            },
        },
    },
];
