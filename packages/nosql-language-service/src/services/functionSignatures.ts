/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Built-in function metadata — signatures, docs, parameter names.
// Used by hover and signature-help services.
// ---------------------------------------------------------------------------

import { type SignatureInfo } from './types.js';

export interface FunctionMeta {
    /** Category (e.g. "Aggregate", "String") */
    category: string;
    /** Short one-line description */
    description: string;
    /** Overload signatures */
    signatures: SignatureInfo[];
}

/**
 * Registry of all built-in CosmosDB NoSQL functions.
 * Key = uppercase function name.
 */
export const FUNCTION_SIGNATURES: Record<string, FunctionMeta> = {
    // ─── Aggregate ─────────────────────────────────────────
    COUNT: {
        category: 'Aggregate',
        description: 'Returns the count of values in the expression.',
        signatures: [
            {
                label: 'COUNT(expression)',
                documentation: 'Returns the number of items.',
                parameters: [{ label: 'expression', documentation: 'Any scalar expression.' }],
            },
        ],
    },
    AVG: {
        category: 'Aggregate',
        description: 'Returns the average of the values in the expression.',
        signatures: [
            {
                label: 'AVG(expression)',
                documentation: 'Returns the average of numeric values.',
                parameters: [{ label: 'expression', documentation: 'A numeric expression.' }],
            },
        ],
    },
    SUM: {
        category: 'Aggregate',
        description: 'Returns the sum of all values in the expression.',
        signatures: [
            {
                label: 'SUM(expression)',
                documentation: 'Returns the sum of numeric values.',
                parameters: [{ label: 'expression', documentation: 'A numeric expression.' }],
            },
        ],
    },
    MIN: {
        category: 'Aggregate',
        description: 'Returns the minimum value in the expression.',
        signatures: [
            {
                label: 'MIN(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },
    MAX: {
        category: 'Aggregate',
        description: 'Returns the maximum value in the expression.',
        signatures: [
            {
                label: 'MAX(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },

    // ─── Type checking ────────────────────────────────────
    IS_DEFINED: {
        category: 'Type check',
        description: 'Returns a Boolean indicating if the property has been assigned a value.',
        signatures: [
            {
                label: 'IS_DEFINED(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },
    IS_NULL: {
        category: 'Type check',
        description: 'Returns a Boolean indicating if the type of the value is null.',
        signatures: [
            {
                label: 'IS_NULL(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },
    IS_ARRAY: {
        category: 'Type check',
        description: 'Returns a Boolean indicating if the type of the value is an array.',
        signatures: [
            {
                label: 'IS_ARRAY(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },
    IS_BOOL: {
        category: 'Type check',
        description: 'Returns a Boolean indicating if the type of the value is a Boolean.',
        signatures: [
            {
                label: 'IS_BOOL(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },
    IS_NUMBER: {
        category: 'Type check',
        description: 'Returns a Boolean indicating if the type of the value is a number.',
        signatures: [
            {
                label: 'IS_NUMBER(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },
    IS_OBJECT: {
        category: 'Type check',
        description: 'Returns a Boolean indicating if the type of the value is a JSON object.',
        signatures: [
            {
                label: 'IS_OBJECT(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },
    IS_STRING: {
        category: 'Type check',
        description: 'Returns a Boolean indicating if the type of the value is a string.',
        signatures: [
            {
                label: 'IS_STRING(expression)',
                parameters: [{ label: 'expression' }],
            },
        ],
    },

    // ─── String ───────────────────────────────────────────
    CONTAINS: {
        category: 'String',
        description: 'Returns a Boolean indicating whether the first expression contains the second.',
        signatures: [
            {
                label: 'CONTAINS(string, substring [, ignoreCase])',
                parameters: [
                    { label: 'string', documentation: 'The string to search in.' },
                    { label: 'substring', documentation: 'The string to search for.' },
                    { label: 'ignoreCase', documentation: 'Optional Boolean for case-insensitive search.' },
                ],
            },
        ],
    },
    STARTSWITH: {
        category: 'String',
        description: 'Returns a Boolean indicating whether the first expression starts with the second.',
        signatures: [
            {
                label: 'STARTSWITH(string, prefix [, ignoreCase])',
                parameters: [{ label: 'string' }, { label: 'prefix' }, { label: 'ignoreCase' }],
            },
        ],
    },
    ENDSWITH: {
        category: 'String',
        description: 'Returns a Boolean indicating whether the first expression ends with the second.',
        signatures: [
            {
                label: 'ENDSWITH(string, suffix [, ignoreCase])',
                parameters: [{ label: 'string' }, { label: 'suffix' }, { label: 'ignoreCase' }],
            },
        ],
    },
    CONCAT: {
        category: 'String',
        description: 'Returns a string that is the result of concatenating two or more string values.',
        signatures: [
            {
                label: 'CONCAT(string1, string2 [, ...])',
                parameters: [{ label: 'string1' }, { label: 'string2' }],
            },
        ],
    },
    LENGTH: {
        category: 'String',
        description: 'Returns the number of characters of the specified string expression.',
        signatures: [
            {
                label: 'LENGTH(string)',
                parameters: [{ label: 'string' }],
            },
        ],
    },
    LOWER: {
        category: 'String',
        description: 'Returns a string expression after converting uppercase characters to lowercase.',
        signatures: [
            {
                label: 'LOWER(string)',
                parameters: [{ label: 'string' }],
            },
        ],
    },
    UPPER: {
        category: 'String',
        description: 'Returns a string expression after converting lowercase characters to uppercase.',
        signatures: [
            {
                label: 'UPPER(string)',
                parameters: [{ label: 'string' }],
            },
        ],
    },
    SUBSTRING: {
        category: 'String',
        description: 'Returns part of a string expression starting at the specified position.',
        signatures: [
            {
                label: 'SUBSTRING(string, start, length)',
                parameters: [
                    { label: 'string' },
                    { label: 'start', documentation: '0-based start position.' },
                    { label: 'length', documentation: 'Number of characters to extract.' },
                ],
            },
        ],
    },
    REPLACE: {
        category: 'String',
        description: 'Replaces all occurrences of a specified string value with another string value.',
        signatures: [
            {
                label: 'REPLACE(string, find, replacement)',
                parameters: [{ label: 'string' }, { label: 'find' }, { label: 'replacement' }],
            },
        ],
    },
    TRIM: {
        category: 'String',
        description: 'Returns a string expression after removing leading and trailing whitespace.',
        signatures: [
            {
                label: 'TRIM(string)',
                parameters: [{ label: 'string' }],
            },
        ],
    },
    INDEX_OF: {
        category: 'String',
        description: 'Returns the starting position of the first occurrence of a substring.',
        signatures: [
            {
                label: 'INDEX_OF(string, substring [, start])',
                parameters: [
                    { label: 'string' },
                    { label: 'substring' },
                    { label: 'start', documentation: 'Optional 0-based start position.' },
                ],
            },
        ],
    },
    REGEXMATCH: {
        category: 'String',
        description: 'Returns a Boolean indicating whether a string matches a regular expression.',
        signatures: [
            {
                label: 'REGEXMATCH(string, pattern [, modifiers])',
                parameters: [
                    { label: 'string' },
                    { label: 'pattern' },
                    { label: 'modifiers', documentation: 'Optional regex modifiers (e.g. "i").' },
                ],
            },
        ],
    },

    // ─── Array ────────────────────────────────────────────
    ARRAY_CONTAINS: {
        category: 'Array',
        description: 'Returns a Boolean indicating whether the array contains the specified value.',
        signatures: [
            {
                label: 'ARRAY_CONTAINS(array, value [, partial])',
                parameters: [
                    { label: 'array' },
                    { label: 'value' },
                    { label: 'partial', documentation: 'Optional Boolean for partial match on objects.' },
                ],
            },
        ],
    },
    ARRAY_LENGTH: {
        category: 'Array',
        description: 'Returns the number of elements of the specified array expression.',
        signatures: [
            {
                label: 'ARRAY_LENGTH(array)',
                parameters: [{ label: 'array' }],
            },
        ],
    },
    ARRAY_CONCAT: {
        category: 'Array',
        description: 'Returns an array that is the result of concatenating two or more array values.',
        signatures: [
            {
                label: 'ARRAY_CONCAT(array1, array2 [, ...])',
                parameters: [{ label: 'array1' }, { label: 'array2' }],
            },
        ],
    },
    ARRAY_SLICE: {
        category: 'Array',
        description: 'Returns part of an array expression.',
        signatures: [
            {
                label: 'ARRAY_SLICE(array, start [, length])',
                parameters: [{ label: 'array' }, { label: 'start' }, { label: 'length' }],
            },
        ],
    },

    // ─── Math ─────────────────────────────────────────────
    ABS: {
        category: 'Math',
        description: 'Returns the absolute (positive) value of the specified numeric expression.',
        signatures: [
            {
                label: 'ABS(number)',
                parameters: [{ label: 'number' }],
            },
        ],
    },
    CEILING: {
        category: 'Math',
        description: 'Returns the smallest integer value ≥ the specified numeric expression.',
        signatures: [
            {
                label: 'CEILING(number)',
                parameters: [{ label: 'number' }],
            },
        ],
    },
    FLOOR: {
        category: 'Math',
        description: 'Returns the largest integer value ≤ the specified numeric expression.',
        signatures: [
            {
                label: 'FLOOR(number)',
                parameters: [{ label: 'number' }],
            },
        ],
    },
    ROUND: {
        category: 'Math',
        description: 'Returns a numeric value rounded to the nearest integer.',
        signatures: [
            {
                label: 'ROUND(number)',
                parameters: [{ label: 'number' }],
            },
        ],
    },
    POWER: {
        category: 'Math',
        description: 'Returns the value of the specified expression raised to the given power.',
        signatures: [
            {
                label: 'POWER(base, exponent)',
                parameters: [{ label: 'base' }, { label: 'exponent' }],
            },
        ],
    },

    // ─── Date/Time ────────────────────────────────────────
    GETCURRENTDATETIME: {
        category: 'Date/Time',
        description: 'Returns the current UTC date and time as an ISO 8601 string.',
        signatures: [
            {
                label: 'GETCURRENTDATETIME()',
                parameters: [],
            },
        ],
    },
    GETCURRENTTIMESTAMP: {
        category: 'Date/Time',
        description: 'Returns the current UTC date and time as a Unix epoch number (milliseconds).',
        signatures: [
            {
                label: 'GETCURRENTTIMESTAMP()',
                parameters: [],
            },
        ],
    },
    DATETIMEADD: {
        category: 'Date/Time',
        description: 'Adds a number value to a specified datetime string.',
        signatures: [
            {
                label: 'DATETIMEADD(part, number, datetime)',
                parameters: [
                    {
                        label: 'part',
                        documentation: '"year", "month", "day", "hour", "minute", "second", "millisecond".',
                    },
                    { label: 'number', documentation: 'Integer amount to add.' },
                    { label: 'datetime', documentation: 'UTC date/time ISO 8601 string.' },
                ],
            },
        ],
    },
    DATETIMEDIFF: {
        category: 'Date/Time',
        description: 'Returns the difference (signed integer) between two datetime strings.',
        signatures: [
            {
                label: 'DATETIMEDIFF(part, startDate, endDate)',
                parameters: [{ label: 'part' }, { label: 'startDate' }, { label: 'endDate' }],
            },
        ],
    },

    // ─── Spatial ──────────────────────────────────────────
    ST_DISTANCE: {
        category: 'Spatial',
        description: 'Returns the distance between two GeoJSON Point expressions.',
        signatures: [
            {
                label: 'ST_DISTANCE(point1, point2)',
                parameters: [{ label: 'point1' }, { label: 'point2' }],
            },
        ],
    },
    ST_WITHIN: {
        category: 'Spatial',
        description: 'Returns a Boolean indicating whether the first GeoJSON object is within the second.',
        signatures: [
            {
                label: 'ST_WITHIN(geometry, polygon)',
                parameters: [{ label: 'geometry' }, { label: 'polygon' }],
            },
        ],
    },
    ST_INTERSECTS: {
        category: 'Spatial',
        description: 'Returns a Boolean indicating whether the two GeoJSON objects intersect.',
        signatures: [
            {
                label: 'ST_INTERSECTS(geometry1, geometry2)',
                parameters: [{ label: 'geometry1' }, { label: 'geometry2' }],
            },
        ],
    },

    // ─── Vector / AI ──────────────────────────────────────
    VECTORDISTANCE: {
        category: 'Vector/AI',
        description: 'Returns the similarity score between two vectors.',
        signatures: [
            {
                label: 'VECTORDISTANCE(vector1, vector2 [, brute_force] [, distanceFunction])',
                parameters: [
                    { label: 'vector1' },
                    { label: 'vector2' },
                    { label: 'brute_force', documentation: 'Optional Boolean to force brute-force search.' },
                    { label: 'distanceFunction', documentation: 'Optional: "cosine", "euclidean", or "dotproduct".' },
                ],
            },
        ],
    },

    // ─── Other ────────────────────────────────────────────
    IIF: {
        category: 'Other',
        description: 'Returns one of two values depending on a Boolean condition.',
        signatures: [
            {
                label: 'IIF(condition, trueValue, falseValue)',
                parameters: [{ label: 'condition' }, { label: 'trueValue' }, { label: 'falseValue' }],
            },
        ],
    },
};

/**
 * Look up function metadata by name (case-insensitive).
 */
export function getFunctionMeta(name: string): FunctionMeta | undefined {
    return FUNCTION_SIGNATURES[name.toUpperCase()];
}
