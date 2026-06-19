/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QueryFixture } from './types.js';

// Helper shorthands used throughout this file.
// fn(name)     → expectAst that asserts a bare FunctionCallScalarExpression in SELECT
// whereFn(name) → expectAst that asserts a FunctionCallScalarExpression in WHERE
const fn = (name: string): object => ({
    select: {
        spec: {
            kind: 'SelectListSpec',
            items: [{ expression: { kind: 'FunctionCallScalarExpression', name: { value: name } } }],
        },
    },
});

const whereFn = (name: string): object => ({
    where: { expression: { kind: 'FunctionCallScalarExpression', name: { value: name } } },
});

export const fixtures: QueryFixture[] = [
    // ── STR series: string functions ────────────────────────────────────────
    {
        id: 'STR-01',
        description: 'CONTAINS in WHERE',
        query: `SELECT * FROM c WHERE CONTAINS(c.name, 'phone')`,
        container: 'products',
        expectAst: whereFn('CONTAINS'),
    },
    {
        id: 'STR-02',
        description: 'STARTSWITH in WHERE',
        query: `SELECT * FROM c WHERE STARTSWITH(c.name, 'Wireless')`,
        container: 'products',
        expectAst: whereFn('STARTSWITH'),
    },
    {
        id: 'STR-03',
        description: 'ENDSWITH in WHERE',
        query: `SELECT * FROM c WHERE ENDSWITH(c.brand, 'X')`,
        container: 'products',
        expectAst: whereFn('ENDSWITH'),
    },
    {
        id: 'STR-04',
        description: 'UPPER in SELECT',
        query: 'SELECT UPPER(c.category) FROM c',
        container: 'products',
        expectAst: fn('UPPER'),
    },
    {
        id: 'STR-05',
        description: 'LOWER in SELECT',
        query: 'SELECT LOWER(c.name) FROM c',
        container: 'products',
        expectAst: fn('LOWER'),
    },
    {
        id: 'STR-06',
        description: 'LENGTH in SELECT',
        query: 'SELECT LENGTH(c.name) FROM c',
        container: 'products',
        expectAst: fn('LENGTH'),
    },
    {
        id: 'STR-07',
        description: 'SUBSTRING in SELECT',
        query: 'SELECT SUBSTRING(c.name, 0, 5) FROM c',
        container: 'products',
        expectAst: fn('SUBSTRING'),
    },
    {
        id: 'STR-08',
        description: 'CONCAT with three args',
        query: `SELECT CONCAT(c.brand, ' - ', c.name) FROM c`,
        container: 'products',
        expectAst: fn('CONCAT'),
    },
    {
        id: 'STR-09',
        description: 'INDEX_OF in SELECT',
        query: `SELECT INDEX_OF(c.name, 'less') FROM c`,
        container: 'products',
        expectAst: fn('INDEX_OF'),
    },
    {
        id: 'STR-10',
        description: 'REPLACE in SELECT',
        query: `SELECT REPLACE(c.name, 'Wireless', 'Wired') FROM c`,
        container: 'products',
        expectAst: fn('REPLACE'),
    },
    {
        id: 'STR-11',
        description: 'REGEXMATCH with flags in WHERE',
        query: `SELECT * FROM c WHERE REGEXMATCH(c.name, '^Wireless.*', 'i')`,
        container: 'products',
        expectAst: whereFn('REGEXMATCH'),
    },
    {
        id: 'STR-12',
        description: 'TRIM in SELECT',
        query: 'SELECT TRIM(c.description) FROM c',
        container: 'products',
        expectAst: fn('TRIM'),
        knownLimitation: 'TRIM() is not implemented in the vnext-preview Linux emulator',
    },
    {
        id: 'STR-13',
        description: 'TOSTRING in SELECT',
        query: 'SELECT TOSTRING(c.price) FROM c',
        container: 'products',
        expectAst: fn('TOSTRING'),
    },
    {
        id: 'STR-14',
        description: 'String concat operator ||',
        query: `SELECT c.name || ' [' || c.category || ']' FROM c`,
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'BinaryScalarExpression', operator: 'StringConcat' } }],
                },
            },
        },
    },

    // ── M series: math functions ────────────────────────────────────────────
    {
        id: 'M-01',
        description: 'ABS in SELECT',
        query: 'SELECT ABS(c.price - 50) FROM c',
        container: 'products',
        expectAst: fn('ABS'),
    },
    {
        id: 'M-02',
        description: 'CEILING in SELECT',
        query: 'SELECT CEILING(c.rating) FROM c',
        container: 'products',
        expectAst: fn('CEILING'),
    },
    {
        id: 'M-03',
        description: 'FLOOR in SELECT',
        query: 'SELECT FLOOR(c.rating) FROM c',
        container: 'products',
        expectAst: fn('FLOOR'),
    },
    {
        id: 'M-04',
        description: 'ROUND in SELECT',
        query: 'SELECT ROUND(c.price) FROM c',
        container: 'products',
        expectAst: fn('ROUND'),
    },
    {
        id: 'M-05',
        description: 'SQRT in SELECT',
        query: 'SELECT SQRT(c.price) FROM c',
        container: 'products',
        expectAst: fn('SQRT'),
    },
    {
        id: 'M-06',
        description: 'POWER in SELECT',
        query: 'SELECT POWER(c.rating, 2) FROM c',
        container: 'products',
        expectAst: fn('POWER'),
    },
    {
        id: 'M-07',
        description: 'LOG in SELECT',
        query: 'SELECT LOG(c.price) FROM c',
        container: 'products',
        expectAst: fn('LOG'),
        knownLimitation:
            'LOG(0) (or a negative argument) produces -Infinity, which is not valid JSON. Azure Cosmos DB rejects it with HTTP 400 error 4001 on both production and the emulator.',
    },
    {
        id: 'M-08',
        description: 'TRUNC in SELECT',
        query: 'SELECT TRUNC(c.price) FROM c',
        container: 'products',
        expectAst: fn('TRUNC'),
    },
    {
        id: 'M-09',
        description: 'SIGN in SELECT',
        query: 'SELECT SIGN(c.price - 100) FROM c',
        container: 'products',
        expectAst: fn('SIGN'),
    },
    {
        id: 'M-10',
        description: 'Arithmetic in projection with alias',
        query: 'SELECT c.price + c.price * 0.1 AS priceWithTax FROM c',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'BinaryScalarExpression', operator: 'Add' },
                            alias: { value: 'priceWithTax' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'M-11',
        description: 'Modulo operator in SELECT',
        query: 'SELECT c.totalAmount % 10 FROM c',
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

    // ── A series: array functions ────────────────────────────────────────────
    {
        id: 'A-01',
        description: 'ARRAY_LENGTH in SELECT',
        query: 'SELECT ARRAY_LENGTH(c.tags) FROM c',
        container: 'products',
        expectAst: fn('ARRAY_LENGTH'),
    },
    {
        id: 'A-02',
        description: 'ARRAY_CONTAINS in WHERE',
        query: `SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, 'sale')`,
        container: 'products',
        expectAst: whereFn('ARRAY_CONTAINS'),
    },
    {
        id: 'A-03',
        description: 'ARRAY_CONTAINS with partial match flag',
        query: `SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, 'sale', true)`,
        container: 'products',
        expectAst: whereFn('ARRAY_CONTAINS'),
    },
    {
        id: 'A-04',
        description: 'ARRAY_SLICE in SELECT',
        query: 'SELECT ARRAY_SLICE(c.tags, 0, 2) FROM c',
        container: 'products',
        expectAst: fn('ARRAY_SLICE'),
    },
    {
        id: 'A-05',
        description: 'ARRAY_CONCAT in SELECT',
        query: `SELECT ARRAY_CONCAT(c.tags, ['extra']) FROM c`,
        container: 'products',
        expectAst: fn('ARRAY_CONCAT'),
    },
    {
        id: 'A-06',
        description: 'ARRAY_LENGTH comparison in WHERE',
        query: 'SELECT * FROM c WHERE ARRAY_LENGTH(c.items) > 3',
        container: 'orders',
        expectAst: {
            where: {
                expression: {
                    kind: 'BinaryScalarExpression',
                    operator: 'GreaterThan',
                    left: { kind: 'FunctionCallScalarExpression', name: { value: 'ARRAY_LENGTH' } },
                },
            },
        },
    },
    {
        id: 'A-07',
        description: 'ARRAY subquery in SELECT (ArrayScalarExpression)',
        query: 'SELECT ARRAY(SELECT VALUE t FROM t IN c.tags) FROM c',
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [{ expression: { kind: 'ArrayScalarExpression' } }],
                },
            },
        },
    },
    {
        id: 'A-08',
        description: 'SETUNION in SELECT',
        query: `SELECT SETUNION(c.tags, ['sale','new']) FROM c`,
        container: 'products',
        expectAst: fn('SETUNION'),
    },
    {
        id: 'A-09',
        description: 'SETINTERSECT in SELECT',
        query: `SELECT SETINTERSECT(c.tags, ['sale','clearance']) FROM c`,
        container: 'products',
        expectAst: fn('SETINTERSECT'),
    },

    // ── D series: date / time functions ─────────────────────────────────────
    {
        id: 'D-01',
        description: 'Date string comparison in WHERE',
        query: `SELECT * FROM c WHERE c.createdAt > '2024-01-01T00:00:00Z'`,
        container: 'products',
        expectAst: { where: { expression: { kind: 'BinaryScalarExpression', operator: 'GreaterThan' } } },
    },
    {
        id: 'D-02',
        description: 'GetCurrentDateTime() in SELECT',
        query: 'SELECT GetCurrentDateTime() FROM c',
        container: 'events',
        expectAst: fn('GetCurrentDateTime'),
    },
    {
        id: 'D-03',
        description: 'DateTimeDiff in WHERE',
        query: `SELECT * FROM c WHERE DateTimeDiff('day', '2024-01-01T00:00:00Z', c.timestamp) < 30`,
        container: 'events',
        expectAst: {
            where: {
                expression: {
                    kind: 'BinaryScalarExpression',
                    operator: 'LessThan',
                    left: { kind: 'FunctionCallScalarExpression', name: { value: 'DateTimeDiff' } },
                },
            },
        },
    },
    {
        id: 'D-04',
        description: 'DateTimeAdd with alias in SELECT',
        query: `SELECT DateTimeAdd('day', 7, c.createdAt) AS expiresAt FROM c`,
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'DateTimeAdd' } },
                            alias: { value: 'expiresAt' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'D-05',
        description: 'DateTimePart with alias in SELECT',
        query: `SELECT DateTimePart('year', c.timestamp) AS year FROM c`,
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'DateTimePart' } },
                            alias: { value: 'year' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'D-06',
        description: 'GetCurrentTimestamp() in SELECT',
        query: 'SELECT GetCurrentTimestamp() FROM c',
        container: 'events',
        expectAst: fn('GetCurrentTimestamp'),
    },
    {
        id: 'D-07',
        description: 'DateTimeToTimestamp in SELECT',
        query: `SELECT DateTimeToTimestamp(c.createdAt) AS ts FROM c`,
        container: 'products',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: {
                                kind: 'FunctionCallScalarExpression',
                                name: { value: 'DateTimeToTimestamp' },
                            },
                            alias: { value: 'ts' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'D-08',
        description: 'TimestampToDateTime in SELECT',
        query: `SELECT TimestampToDateTime(GetCurrentTimestamp()) AS dt FROM c`,
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: {
                                kind: 'FunctionCallScalarExpression',
                                name: { value: 'TimestampToDateTime' },
                            },
                            alias: { value: 'dt' },
                        },
                    ],
                },
            },
        },
    },
    {
        id: 'D-09',
        description: 'DateTimeBin rounds timestamp to daily bin',
        query: `SELECT DateTimeBin(c.timestamp, 'day', 1) AS day FROM c`,
        container: 'events',
        expectAst: {
            select: {
                spec: {
                    kind: 'SelectListSpec',
                    items: [
                        {
                            expression: { kind: 'FunctionCallScalarExpression', name: { value: 'DateTimeBin' } },
                            alias: { value: 'day' },
                        },
                    ],
                },
            },
        },
    },

    // ── STR-15..23: additional string functions ─────────────────────────────
    {
        id: 'STR-15',
        description: 'LTRIM in SELECT',
        query: 'SELECT LTRIM(c.name) FROM c',
        container: 'products',
        expectAst: fn('LTRIM'),
    },
    {
        id: 'STR-16',
        description: 'RTRIM in SELECT',
        query: 'SELECT RTRIM(c.name) FROM c',
        container: 'products',
        expectAst: fn('RTRIM'),
    },
    {
        id: 'STR-17',
        description: 'LEFT in SELECT',
        query: 'SELECT LEFT(c.name, 5) FROM c',
        container: 'products',
        expectAst: fn('LEFT'),
    },
    {
        id: 'STR-18',
        description: 'RIGHT in SELECT',
        query: 'SELECT RIGHT(c.name, 5) FROM c',
        container: 'products',
        expectAst: fn('RIGHT'),
    },
    {
        id: 'STR-19',
        description: 'REVERSE in SELECT',
        query: 'SELECT REVERSE(c.name) FROM c',
        container: 'products',
        expectAst: fn('REVERSE'),
    },
    {
        id: 'STR-20',
        description: 'StringEquals case-sensitive in WHERE',
        query: `SELECT * FROM c WHERE StringEquals(c.category, 'Books')`,
        container: 'products',
        expectAst: whereFn('StringEquals'),
    },
    {
        id: 'STR-21',
        description: 'StringEquals case-insensitive in WHERE',
        query: `SELECT * FROM c WHERE StringEquals(c.category, 'books', true)`,
        container: 'products',
        expectAst: whereFn('StringEquals'),
    },
    {
        id: 'STR-22',
        description: 'ContainsAnyCI in WHERE',
        query: `SELECT * FROM c WHERE ContainsAnyCI(c.name, 'python', 'java')`,
        container: 'products',
        expectAst: whereFn('ContainsAnyCI'),
    },
    {
        id: 'STR-23',
        description: 'ContainsAllCI in WHERE',
        query: `SELECT * FROM c WHERE ContainsAllCI(c.name, 'crash', 'course')`,
        container: 'products',
        expectAst: whereFn('ContainsAllCI'),
    },

    // ── M-12..23: additional math functions ─────────────────────────────────
    {
        id: 'M-12',
        description: 'EXP in SELECT',
        query: 'SELECT EXP(c.rating) FROM c',
        container: 'products',
        expectAst: fn('EXP'),
    },
    {
        id: 'M-13',
        description: 'LOG10 in SELECT',
        query: 'SELECT LOG10(c.price) FROM c',
        container: 'products',
        expectAst: fn('LOG10'),
        knownLimitation:
            'LOG10(0) (or a negative argument) produces -Infinity, which is not valid JSON. Azure Cosmos DB rejects it with HTTP 400 error 4001 on both production and the emulator.',
    },
    {
        id: 'M-14',
        description: 'SIN in SELECT',
        query: 'SELECT SIN(c.rating) FROM c',
        container: 'products',
        expectAst: fn('SIN'),
    },
    {
        id: 'M-15',
        description: 'COS in SELECT',
        query: 'SELECT COS(c.rating) FROM c',
        container: 'products',
        expectAst: fn('COS'),
    },
    {
        id: 'M-16',
        description: 'TAN in SELECT',
        query: 'SELECT TAN(c.rating) FROM c',
        container: 'products',
        expectAst: fn('TAN'),
    },
    {
        id: 'M-17',
        description: 'ASIN with literal in SELECT',
        query: 'SELECT ASIN(0.5) FROM c',
        container: 'products',
        expectAst: fn('ASIN'),
    },
    {
        id: 'M-18',
        description: 'ACOS with literal in SELECT',
        query: 'SELECT ACOS(0.5) FROM c',
        container: 'products',
        expectAst: fn('ACOS'),
    },
    {
        id: 'M-19',
        description: 'ATAN in SELECT',
        query: 'SELECT ATAN(c.price) FROM c',
        container: 'products',
        expectAst: fn('ATAN'),
    },
    {
        id: 'M-20',
        description: 'DEGREES in SELECT',
        query: 'SELECT DEGREES(c.rating) FROM c',
        container: 'products',
        expectAst: fn('DEGREES'),
    },
    {
        id: 'M-21',
        description: 'RADIANS in SELECT',
        query: 'SELECT RADIANS(c.rating) FROM c',
        container: 'products',
        expectAst: fn('RADIANS'),
    },
    {
        id: 'M-22',
        description: 'PI in SELECT',
        query: 'SELECT PI() FROM c',
        container: 'products',
        expectAst: fn('PI'),
    },
    {
        id: 'M-23',
        description: 'RAND in SELECT',
        query: 'SELECT RAND() FROM c',
        container: 'products',
        expectAst: fn('RAND'),
    },

    // ── A-10..11: additional array functions ─────────────────────────────────
    {
        id: 'A-10',
        description: 'ARRAY_CONTAINS_ALL in WHERE',
        query: `SELECT * FROM c WHERE ARRAY_CONTAINS_ALL(c.tags, ['bundle', 'certified'])`,
        container: 'products',
        expectAst: whereFn('ARRAY_CONTAINS_ALL'),
    },
    {
        id: 'A-11',
        description: 'ARRAY_CONTAINS_ANY in WHERE',
        query: `SELECT * FROM c WHERE ARRAY_CONTAINS_ANY(c.tags, ['sale', 'bundle'])`,
        container: 'products',
        expectAst: whereFn('ARRAY_CONTAINS_ANY'),
    },
];
