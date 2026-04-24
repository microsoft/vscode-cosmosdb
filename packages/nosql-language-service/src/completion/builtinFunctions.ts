/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Built-in functions for CosmosDB NoSQL SQL
// Source: SqlStringTokens.txt — "System Built-in Functions" section.
// Uses the underscore-separated canonical forms (ARRAY_LENGTH not ARRAYLENGTH).
// Grouped by category for priority ranking.
// ---------------------------------------------------------------------------

/** Aggregate functions — commonly used in SELECT */
const FN_AGGREGATE = ['AVG', 'COUNT', 'COUNTIF', 'MAX', 'MIN', 'SUM', 'MAKELIST', 'MAKESET'];

/** Type-checking functions — commonly used in WHERE */
const FN_TYPE_CHECK = [
    'IS_ARRAY',
    'IS_BOOL',
    'IS_BOOLEAN',
    'IS_DATETIME',
    'IS_DEFINED',
    'IS_FINITE_NUMBER',
    'IS_INTEGER',
    'IS_NULL',
    'IS_NUMBER',
    'IS_OBJECT',
    'IS_PRIMITIVE',
    'IS_STRING',
];

/** String functions */
const FN_STRING = [
    'CONCAT',
    'CONTAINS',
    'CONTAINS_ALL_CI',
    'CONTAINS_ALL_CS',
    'CONTAINS_ANY_CI',
    'CONTAINS_ANY_CS',
    'ENDSWITH',
    'INDEX_OF',
    'LASTINDEXOF',
    'LASTSUBSTRINGAFTER',
    'LASTSUBSTRINGBEFORE',
    'LEFT',
    'LENGTH',
    'LOWER',
    'LTRIM',
    'REGEXEXTRACT',
    'REGEXEXTRACTALL',
    'REGEXMATCH',
    'REPLACE',
    'REPLICATE',
    'REVERSE',
    'RIGHT',
    'RTRIM',
    'STARTSWITH',
    'STRINGEQUALS',
    'STRING_EQUALS',
    'STRINGJOIN',
    'STRING_JOIN',
    'STRINGSPLIT',
    'STRING_SPLIT',
    'SUBSTRING',
    'SUBSTRINGAFTER',
    'SUBSTRINGBEFORE',
    'TOSTRING',
    'TO_STRING',
    'TRIM',
    'UPPER',
];

/** Array functions */
const FN_ARRAY = [
    'ARRAY_AVG',
    'ARRAY_CONCAT',
    'ARRAY_CONTAINS',
    'ARRAY_CONTAINS_ALL',
    'ARRAY_CONTAINS_ANY',
    'ARRAY_LENGTH',
    'ARRAY_MAX',
    'ARRAY_MEDIAN',
    'ARRAY_MIN',
    'ARRAY_SLICE',
    'ARRAY_SUM',
    'OBJECTTOARRAY',
    'OBJECT_TO_ARRAY',
    'SETDIFFERENCE',
    'SET_DIFFERENCE',
    'SETEQUAL',
    'SET_EQUAL',
    'SETINTERSECT',
    'SET_INTERSECT',
    'SETUNION',
    'SET_UNION',
    'STRINGTOARRAY',
    'STRING_TO_ARRAY',
];

/** Mathematical functions */
const FN_MATH = [
    'ABS',
    'ACOS',
    'ASIN',
    'ATAN',
    'ATN2',
    'CEILING',
    'CHOOSE',
    'COS',
    'COT',
    'DEGREES',
    'EXP',
    'FLOOR',
    'LOG',
    'LOG10',
    'NUMBERBIN',
    'PI',
    'POWER',
    'RADIANS',
    'RAND',
    'ROUND',
    'SIGN',
    'SIN',
    'SQRT',
    'SQUARE',
    'TAN',
    'TRUNC',
];

/** Date/time functions */
const FN_DATETIME = [
    'DATETIMEADD',
    'DATETIMEBIN',
    'DATETIMEDIFF',
    'DATETIMEFORMAT',
    'DATETIMEFROMPARTS',
    'DATETIMEPART',
    'DATETIMETOTICKS',
    'DATETIMETOTIMESTAMP',
    'DAY',
    'MONTH',
    'YEAR',
    'GETCURRENTDATETIME',
    'GETCURRENTDATETIMESTATIC',
    'GETCURRENTTICKS',
    'GETCURRENTTICKSSTATIC',
    'GETCURRENTTIMESTAMP',
    'GETCURRENTTIMESTAMPSTATIC',
    'NOW',
    'AGO',
    'TICKSTODATETIME',
    'TIMESTAMPTODATETIME',
];

/** Spatial functions */
const FN_SPATIAL = ['ST_AREA', 'ST_DISTANCE', 'ST_INTERSECTS', 'ST_ISVALID', 'ST_ISVALIDDETAILED', 'ST_WITHIN'];

/** Conversion functions */
const FN_CONVERSION = [
    'STRINGTOBOOLEAN',
    'STRING_TO_BOOLEAN',
    'STRINGTONULL',
    'STRING_TO_NULL',
    'STRINGTONUMBER',
    'STRING_TO_NUMBER',
    'STRINGTOOBJECT',
    'STRING_TO_OBJECT',
];

/** Integer math functions */
const FN_INTMATH = [
    'INTADD',
    'INTBITAND',
    'INTBITLEFTSHIFT',
    'INTBITNOT',
    'INTBITOR',
    'INTBITRIGHTSHIFT',
    'INTBITXOR',
    'INTDIV',
    'INTMOD',
    'INTMUL',
    'INTMULTIPLY',
    'INTSUB',
];

/** Full-text search functions */
const FN_FULLTEXT = [
    'FULLTEXT_CONTAINS',
    'FULLTEXTCONTAINS',
    'FULLTEXT_CONTAINS_ALL',
    'FULLTEXTCONTAINSALL',
    'FULLTEXT_CONTAINS_ANY',
    'FULLTEXTCONTAINSANY',
    'FULLTEXTSCORE',
];

/** Vector / AI functions */
const FN_VECTOR = ['VECTORDISTANCE', 'RRF'];

/** Other utility functions */
const FN_OTHER = ['DOCUMENTID', 'HASH', 'IIF'];

/**
 * All built-in functions grouped by category.
 * Each entry is [categoryName, functions[], basePriority].
 * Lower basePriority = appears higher in completion list.
 */
export const FUNCTION_CATEGORIES: [string, string[], number][] = [
    ['Aggregate', FN_AGGREGATE, 0],
    ['Type check', FN_TYPE_CHECK, 5],
    ['String', FN_STRING, 15],
    ['Array', FN_ARRAY, 25],
    ['Math', FN_MATH, 35],
    ['Date/Time', FN_DATETIME, 40],
    ['Conversion', FN_CONVERSION, 45],
    ['Int math', FN_INTMATH, 50],
    ['Full-text', FN_FULLTEXT, 55],
    ['Spatial', FN_SPATIAL, 60],
    ['Vector/AI', FN_VECTOR, 65],
    ['Other', FN_OTHER, 70],
];

/** Flat list of all built-in function names */
export const BUILTIN_FUNCTIONS: string[] = FUNCTION_CATEGORIES.flatMap(([, fns]) => fns);

