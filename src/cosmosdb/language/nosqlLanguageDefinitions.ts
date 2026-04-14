/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared language definitions for CosmosDB NoSQL query language.
 *
 * This module is environment-agnostic — it imports neither `vscode` nor `monaco-editor`.
 * It is consumed by both the VS Code extension host (for the VS Code editor completion provider)
 * and the webview (for the Monaco Monarch tokenizer and Monaco completion provider).
 *
 * Pure data only: interfaces and constants. All parser/logic functions live in nosqlParser.ts.
 *
 * Reference: https://learn.microsoft.com/en-us/cosmos-db/query/
 */

// ─── Language ID ───────────────────────────────────────────────────────────────

export const NOSQL_LANGUAGE_ID = 'nosql';

// ─── Clause types ──────────────────────────────────────────────────────────────

/** Clause types in the CosmosDB NoSQL query language. */
export type ClauseType = 'select' | 'from' | 'where' | 'orderby' | 'groupby' | 'join' | 'offset' | 'limit' | 'none';

// ─── Keyword definitions ───────────────────────────────────────────────────────

/** Discriminator for keyword categories, used for completion item grouping. */
export type KeywordCategory = 'clause' | 'keyword' | 'operator' | 'constant';

/**
 * Full metadata for a single CosmosDB NoSQL keyword.
 */
export interface KeywordInfo {
    /** The keyword as typed in a query (e.g. "ORDER BY", "SELECT"). */
    name: string;
    /** Short human-readable description for hover/completion docs. */
    description: string;
    /** Same as `name` — kept for shape consistency with FunctionInfo. */
    signature: string;
    /** Documentation URL on learn.microsoft.com */
    link: string;
    /** Completion insert text — same as `name`. */
    snippet: string;
    /** Semantic category for grouping/sorting completions. */
    category: KeywordCategory;
    /**
     * Clause contexts where this keyword is most relevant.
     * When the cursor is in one of these clauses, the keyword is boosted in sort order.
     * Keywords still appear in all contexts but with lower priority when not matching.
     */
    validAfter?: ClauseType[];
}

/**
 * All CosmosDB NoSQL keywords with full metadata for completion, hover, and documentation.
 *
 * NOTE: Multi-word keywords like "ORDER BY" are listed as a single entry for completion,
 * but `NOSQL_KEYWORD_TOKENS` (derived below) splits them for the Monarch tokenizer.
 */
export const NOSQL_KEYWORDS: readonly KeywordInfo[] = [
    // ── Clauses ──────────────────────────────────────────────────────────────
    {
        name: 'SELECT',
        description: 'Specifies the fields or expressions to return in the query result.',
        signature: 'SELECT',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/select',
        snippet: 'SELECT ',
        category: 'clause',
        validAfter: ['none'],
    },
    {
        name: 'FROM',
        description: 'Specifies the data source container or subquery to query from.',
        signature: 'FROM',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/from',
        snippet: 'FROM ',
        category: 'clause',
        validAfter: ['select'],
    },
    {
        name: 'WHERE',
        description: 'Filters the documents returned by applying a Boolean condition.',
        signature: 'WHERE',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/where',
        snippet: 'WHERE ',
        category: 'clause',
        validAfter: ['from', 'join'],
    },
    {
        name: 'ORDER BY',
        description: 'Sorts the query results in ascending or descending order.',
        signature: 'ORDER BY',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/order-by',
        snippet: 'ORDER BY ',
        category: 'clause',
        validAfter: ['from', 'where', 'groupby'],
    },
    {
        name: 'ORDER BY RANK',
        description: 'Sorts query results by relevancy rank using a scoring function such as FULLTEXTSCORE or RRF.',
        signature: 'ORDER BY RANK',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/order-by-rank',
        snippet: 'ORDER BY RANK ',
        category: 'clause',
        validAfter: ['from', 'where'],
    },
    {
        name: 'GROUP BY',
        description: 'Groups query results by the specified expression and applies aggregate functions.',
        signature: 'GROUP BY',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/group-by',
        snippet: 'GROUP BY ',
        category: 'clause',
        validAfter: ['from', 'where'],
    },
    {
        name: 'JOIN',
        description: 'Performs an intra-document self-join to iterate over nested arrays.',
        signature: 'JOIN',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/join',
        snippet: 'JOIN ',
        category: 'clause',
        validAfter: ['from', 'join'],
    },
    {
        name: 'OFFSET',
        description: 'Skips the specified number of results before returning items (used with LIMIT).',
        signature: 'OFFSET',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/offset-limit',
        snippet: 'OFFSET ',
        category: 'clause',
        validAfter: ['from', 'where', 'orderby', 'groupby'],
    },
    {
        name: 'LIMIT',
        description: 'Limits the number of items returned by the query (used with OFFSET).',
        signature: 'LIMIT',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/offset-limit',
        snippet: 'LIMIT ',
        category: 'clause',
        validAfter: ['offset'],
    },

    // ── Modifiers / keywords ──────────────────────────────────────────────────
    {
        name: 'AS',
        description: 'Assigns an alias to an expression, field, or subquery in the SELECT or FROM clause.',
        signature: 'AS',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/from',
        snippet: 'AS ',
        category: 'keyword',
        validAfter: ['select', 'from'],
    },
    {
        name: 'ASC',
        description: 'Sorts the ORDER BY results in ascending order (default).',
        signature: 'ASC',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/order-by',
        snippet: 'ASC',
        category: 'keyword',
        validAfter: ['orderby'],
    },
    {
        name: 'BETWEEN',
        description: 'Evaluates whether a value falls between two inclusive bounds.',
        signature: 'BETWEEN',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/between',
        snippet: 'BETWEEN ',
        category: 'operator',
        validAfter: ['where'],
    },
    {
        name: 'DESC',
        description: 'Sorts the ORDER BY results in descending order.',
        signature: 'DESC',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/order-by',
        snippet: 'DESC',
        category: 'keyword',
        validAfter: ['orderby'],
    },
    {
        name: 'DISTINCT',
        description: 'Eliminates duplicate values from the query result set.',
        signature: 'DISTINCT',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/distinct',
        snippet: 'DISTINCT ',
        category: 'keyword',
        validAfter: ['select'],
    },
    {
        name: 'EXISTS',
        description: 'Returns true if a subquery returns any results.',
        signature: 'EXISTS',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/keywords#exists',
        snippet: 'EXISTS ',
        category: 'operator',
        validAfter: ['where'],
    },
    {
        name: 'IN',
        description: 'Checks whether a value matches any value in a list or subquery.',
        signature: 'IN',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/in',
        snippet: 'IN ',
        category: 'operator',
        validAfter: ['where', 'join'],
    },
    {
        name: 'LIKE',
        description: 'Checks whether a string matches a specified pattern using wildcard characters.',
        signature: 'LIKE',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/like',
        snippet: 'LIKE ',
        category: 'operator',
        validAfter: ['where'],
    },
    {
        name: 'TOP',
        description: 'Returns only the first N items from the query result.',
        signature: 'TOP',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/top',
        snippet: 'TOP ',
        category: 'keyword',
        validAfter: ['select'],
    },
    {
        name: 'VALUE',
        description: 'Projects a scalar value instead of a full JSON object in the SELECT result.',
        signature: 'VALUE',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/select#select-value',
        snippet: 'VALUE ',
        category: 'keyword',
        validAfter: ['select'],
    },

    // ── Logical operators ─────────────────────────────────────────────────────
    {
        name: 'AND',
        description: 'Returns true when both operands are true.',
        signature: 'AND',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/logical-operators',
        snippet: 'AND ',
        category: 'operator',
        validAfter: ['where'],
    },
    {
        name: 'NOT',
        description: 'Negates the boolean value of an expression.',
        signature: 'NOT',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/logical-operators',
        snippet: 'NOT ',
        category: 'operator',
        validAfter: ['where'],
    },
    {
        name: 'OR',
        description: 'Returns true when at least one operand is true.',
        signature: 'OR',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/logical-operators',
        snippet: 'OR ',
        category: 'operator',
        validAfter: ['where'],
    },

    // ── Constants ────────────────────────────────────────────────────────────
    {
        name: 'FALSE',
        description: 'Boolean false constant.',
        signature: 'FALSE',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/constants',
        snippet: 'FALSE',
        category: 'constant',
        validAfter: ['where', 'select'],
    },
    {
        name: 'NULL',
        description: 'Represents a null value.',
        signature: 'NULL',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/constants',
        snippet: 'NULL',
        category: 'constant',
        validAfter: ['where', 'select'],
    },
    {
        name: 'TRUE',
        description: 'Boolean true constant.',
        signature: 'TRUE',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/constants',
        snippet: 'TRUE',
        category: 'constant',
        validAfter: ['where', 'select'],
    },
    {
        name: 'UNDEFINED',
        description: 'Represents an undefined value (property does not exist in the document).',
        signature: 'UNDEFINED',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/constants',
        snippet: 'UNDEFINED',
        category: 'constant',
        validAfter: ['where', 'select'],
    },
];

/**
 * Individual keyword tokens for syntax highlighting (Monarch / TextMate).
 * Derived from NOSQL_KEYWORDS by splitting multi-word entries and deduplicating.
 */
export const NOSQL_KEYWORD_TOKENS: readonly string[] = [
    ...new Set(NOSQL_KEYWORDS.flatMap((kw) => kw.name.split(' '))),
].sort();

/**
 * Word-based operator tokens (AND, OR, NOT, BETWEEN, IN, LIKE, EXISTS) for syntax highlighting.
 * These are a subset of NOSQL_KEYWORDS with category 'operator' and receive a separate
 * token class so themes can color them differently from clause keywords.
 */
export const NOSQL_OPERATOR_TOKENS: readonly string[] = NOSQL_KEYWORDS.filter((kw) => kw.category === 'operator').map(
    (kw) => kw.name,
);

// ─── Built-in function definitions ─────────────────────────────────────────────

/**
 * Describes a single argument of a built-in NoSQL function.
 */
export interface NoSqlArgumentDefinition {
    /** Argument name as it appears in the signature (e.g. "str", "expr", "ignoreCase"). */
    name: string;
    /** Inferred type: "string" | "number" | "boolean" | "array" | "object" | "any" */
    type: string;
    /** True when the argument is wrapped in `[...]` in the signature. */
    optional?: boolean;
}

export interface FunctionInfo {
    name: string;
    signature: string;
    description: string;
    /** Documentation URL on learn.microsoft.com */
    link: string;
    /** Pre-computed Monaco/VS Code snippet string with tab stops. */
    snippet: string;
    /** Parsed argument list derived from the signature. */
    arguments: NoSqlArgumentDefinition[];
}

export const NOSQL_FUNCTIONS: readonly FunctionInfo[] = [
    // ── Aggregation ───────────────────────────────────────────────────────────
    {
        name: 'AVG',
        signature: 'AVG(expr)',
        description: 'Calculates the average of the values in the expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/avg',
        snippet: 'AVG(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'COUNT',
        signature: 'COUNT(expr)',
        description: 'Returns the count of the values in the expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/count',
        snippet: 'COUNT(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'MAX',
        signature: 'MAX(expr)',
        description: 'Returns the maximum value of the specified expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/max',
        snippet: 'MAX(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'MIN',
        signature: 'MIN(expr)',
        description: 'Returns the minimum value of the specified expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/min',
        snippet: 'MIN(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'SUM',
        signature: 'SUM(expr)',
        description: 'Calculates the sum of the values in the expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/sum',
        snippet: 'SUM(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },

    // ── Mathematical ─────────────────────────────────────────────────────────
    {
        name: 'ABS',
        signature: 'ABS(expr)',
        description: 'Calculates the absolute (positive) value of the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/abs',
        snippet: 'ABS(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'ACOS',
        signature: 'ACOS(expr)',
        description:
            'Calculates the trigonometric arccosine of the specified numeric value. The arccosine is the angle, in radians, whose cosine is the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/acos',
        snippet: 'ACOS(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'ASIN',
        signature: 'ASIN(expr)',
        description:
            'Calculates the trigonometric arcsine of the specified numeric value. The arcsine is the angle, in radians, whose sine is the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/asin',
        snippet: 'ASIN(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'ATAN',
        signature: 'ATAN(expr)',
        description:
            'Calculates the trigonometric arctangent of the specified numeric value. The arctangent is the angle, in radians, whose tangent is the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/atan',
        snippet: 'ATAN(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'ATN2',
        signature: 'ATN2(y, x)',
        description: 'Calculates the principal value of the arctangent of y/x, expressed in radians.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/atn2',
        snippet: 'ATN2(${1:y}, ${2:x})$0',
        arguments: [
            { name: 'y', type: 'any' },
            { name: 'x', type: 'any' },
        ],
    },
    {
        name: 'CEILING',
        signature: 'CEILING(expr)',
        description: 'Calculates the smallest integer value greater than or equal to the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/ceiling',
        snippet: 'CEILING(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'COS',
        signature: 'COS(expr)',
        description: 'Calculates the trigonometric cosine of the specified angle in radians.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/cos',
        snippet: 'COS(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'COT',
        signature: 'COT(expr)',
        description: 'Calculates the trigonometric cotangent of the specified angle in radians.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/cot',
        snippet: 'COT(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'DEGREES',
        signature: 'DEGREES(radians)',
        description: 'Calculates the corresponding angle in degrees for an angle specified in radians.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/degrees',
        snippet: 'DEGREES(${1:radians})$0',
        arguments: [{ name: 'radians', type: 'number' }],
    },
    {
        name: 'EXP',
        signature: 'EXP(expr)',
        description: 'Calculates the exponential value of the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/exp',
        snippet: 'EXP(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'FLOOR',
        signature: 'FLOOR(expr)',
        description: 'Calculates the largest integer less than or equal to the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/floor',
        snippet: 'FLOOR(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'INTADD',
        signature: 'INTADD(a, b)',
        description: 'Returns the sum of two integer values.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intadd',
        snippet: 'INTADD(${1:a}, ${2:b})$0',
        arguments: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
        ],
    },
    {
        name: 'INTBITAND',
        signature: 'INTBITAND(a, b)',
        description: 'Returns a comparison of the bits of each operand using an inclusive AND operator.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intbitand',
        snippet: 'INTBITAND(${1:a}, ${2:b})$0',
        arguments: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
        ],
    },
    {
        name: 'INTBITLEFTSHIFT',
        signature: 'INTBITLEFTSHIFT(value, shift)',
        description: 'Returns the result of a bitwise left shift operation on an integer value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intbitleftshift',
        snippet: 'INTBITLEFTSHIFT(${1:value}, ${2:shift})$0',
        arguments: [
            { name: 'value', type: 'any' },
            { name: 'shift', type: 'number' },
        ],
    },
    {
        name: 'INTBITNOT',
        signature: 'INTBITNOT(value)',
        description: 'Returns the result of a bitwise NOT operation on an integer value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intbitnot',
        snippet: 'INTBITNOT(${1:value})$0',
        arguments: [{ name: 'value', type: 'any' }],
    },
    {
        name: 'INTBITOR',
        signature: 'INTBITOR(a, b)',
        description: 'Returns the result of a bitwise inclusive OR operation on two integer values.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intbitor',
        snippet: 'INTBITOR(${1:a}, ${2:b})$0',
        arguments: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
        ],
    },
    {
        name: 'INTBITRIGHTSHIFT',
        signature: 'INTBITRIGHTSHIFT(value, shift)',
        description: 'Returns the result of a bitwise right shift operation on an integer value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intbitrightshift',
        snippet: 'INTBITRIGHTSHIFT(${1:value}, ${2:shift})$0',
        arguments: [
            { name: 'value', type: 'any' },
            { name: 'shift', type: 'number' },
        ],
    },
    {
        name: 'INTBITXOR',
        signature: 'INTBITXOR(a, b)',
        description: 'Returns the result of a bitwise exclusive OR operation on two integer values.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intbitxor',
        snippet: 'INTBITXOR(${1:a}, ${2:b})$0',
        arguments: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
        ],
    },
    {
        name: 'INTDIV',
        signature: 'INTDIV(a, b)',
        description: 'Returns the result of dividing the first integer value by the second.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intdiv',
        snippet: 'INTDIV(${1:a}, ${2:b})$0',
        arguments: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
        ],
    },
    {
        name: 'INTMOD',
        signature: 'INTMOD(a, b)',
        description: 'Returns the remainder of dividing the first integer value by the second.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intmod',
        snippet: 'INTMOD(${1:a}, ${2:b})$0',
        arguments: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
        ],
    },
    {
        name: 'INTMUL',
        signature: 'INTMUL(a, b)',
        description: 'Returns the product of two integer values.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intmul',
        snippet: 'INTMUL(${1:a}, ${2:b})$0',
        arguments: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
        ],
    },
    {
        name: 'INTSUB',
        signature: 'INTSUB(a, b)',
        description: 'Returns the result of subtracting the second integer value from the first.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/intsub',
        snippet: 'INTSUB(${1:a}, ${2:b})$0',
        arguments: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
        ],
    },
    {
        name: 'LOG',
        signature: 'LOG(expr [, base])',
        description: 'Returns the natural logarithm of the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/log',
        snippet: 'LOG(${1:expr})$0',
        arguments: [
            { name: 'expr', type: 'any' },
            { name: 'base', type: 'any', optional: true },
        ],
    },
    {
        name: 'LOG10',
        signature: 'LOG10(expr)',
        description: 'Returns the base-10 logarithm of the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/log10',
        snippet: 'LOG10(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'NUMBERBIN',
        signature: 'NUMBERBIN(value [, binSize])',
        description: 'Calculates the input value rounded to a multiple of the specified size.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/numberbin',
        snippet: 'NUMBERBIN(${1:value})$0',
        arguments: [
            { name: 'value', type: 'any' },
            { name: 'binSize', type: 'number', optional: true },
        ],
    },
    {
        name: 'PI',
        signature: 'PI()',
        description: 'Returns the constant value of Pi.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/pi',
        snippet: 'PI()$0',
        arguments: [],
    },
    {
        name: 'POWER',
        signature: 'POWER(base, exponent)',
        description: 'Returns the value of the specified expression multiplied by itself the given number of times.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/power',
        snippet: 'POWER(${1:base}, ${2:exponent})$0',
        arguments: [
            { name: 'base', type: 'any' },
            { name: 'exponent', type: 'any' },
        ],
    },
    {
        name: 'RADIANS',
        signature: 'RADIANS(degrees)',
        description: 'Returns the corresponding angle in radians for an angle specified in degrees.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/radians',
        snippet: 'RADIANS(${1:degrees})$0',
        arguments: [{ name: 'degrees', type: 'number' }],
    },
    {
        name: 'RAND',
        signature: 'RAND()',
        description: 'Returns a randomly generated numeric value from zero to one.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/rand',
        snippet: 'RAND()$0',
        arguments: [],
    },
    {
        name: 'ROUND',
        signature: 'ROUND(expr [, length])',
        description: 'Returns a numeric value rounded to the closest integer value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/round',
        snippet: 'ROUND(${1:expr})$0',
        arguments: [
            { name: 'expr', type: 'any' },
            { name: 'length', type: 'number', optional: true },
        ],
    },
    {
        name: 'SIGN',
        signature: 'SIGN(expr)',
        description: 'Returns the positive (+1), zero (0), or negative (-1) sign of the specified numeric expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/sign',
        snippet: 'SIGN(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'SIN',
        signature: 'SIN(expr)',
        description: 'Returns the trigonometric sine of the specified angle in radians.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/sin',
        snippet: 'SIN(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'SQRT',
        signature: 'SQRT(expr)',
        description: 'Returns the square root of the specified numeric value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/sqrt',
        snippet: 'SQRT(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'SQUARE',
        signature: 'SQUARE(expr)',
        description: 'Returns the square of the specified numeric value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/square',
        snippet: 'SQUARE(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'TAN',
        signature: 'TAN(expr)',
        description: 'Returns the trigonometric tangent of the specified angle in radians.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/tan',
        snippet: 'TAN(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'TRUNC',
        signature: 'TRUNC(expr)',
        description: 'Returns a numeric value truncated to the closest integer value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/trunc',
        snippet: 'TRUNC(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },

    // ── Type checking ─────────────────────────────────────────────────────────
    {
        name: 'IS_ARRAY',
        signature: 'IS_ARRAY(expr)',
        description: 'Returns a boolean value indicating if the type of the specified expression is an array.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-array',
        snippet: 'IS_ARRAY(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_BOOL',
        signature: 'IS_BOOL(expr)',
        description: 'Returns a boolean value indicating if the type of the specified expression is a boolean.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-bool',
        snippet: 'IS_BOOL(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_DEFINED',
        signature: 'IS_DEFINED(expr)',
        description: 'Returns a boolean indicating if the property has been assigned a value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-defined',
        snippet: 'IS_DEFINED(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_FINITE_NUMBER',
        signature: 'IS_FINITE_NUMBER(expr)',
        description: 'Returns a boolean indicating if a number is a finite number (not infinite).',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-finite-number',
        snippet: 'IS_FINITE_NUMBER(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_INTEGER',
        signature: 'IS_INTEGER(expr)',
        description: 'Returns a boolean indicating if a number is a 64-bit signed integer.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-integer',
        snippet: 'IS_INTEGER(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_NULL',
        signature: 'IS_NULL(expr)',
        description: 'Returns a boolean value indicating if the type of the specified expression is null.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-null',
        snippet: 'IS_NULL(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_NUMBER',
        signature: 'IS_NUMBER(expr)',
        description: 'Returns a boolean value indicating if the type of the specified expression is a number.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-number',
        snippet: 'IS_NUMBER(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_OBJECT',
        signature: 'IS_OBJECT(expr)',
        description: 'Returns a boolean value indicating if the type of the specified expression is a JSON object.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-object',
        snippet: 'IS_OBJECT(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_PRIMITIVE',
        signature: 'IS_PRIMITIVE(expr)',
        description:
            'Returns a boolean value indicating if the type of the specified expression is a primitive (string, boolean, numeric, or null).',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-primitive',
        snippet: 'IS_PRIMITIVE(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'IS_STRING',
        signature: 'IS_STRING(expr)',
        description: 'Returns a boolean value indicating if the type of the specified expression is a string.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/is-string',
        snippet: 'IS_STRING(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'STRINGTONULL',
        signature: 'STRINGTONULL(str)',
        description: 'Converts a string expression to null.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/stringtonull',
        snippet: 'STRINGTONULL(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'STRINGTONUMBER',
        signature: 'STRINGTONUMBER(str)',
        description: 'Converts a string expression to a number.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/stringtonumber',
        snippet: 'STRINGTONUMBER(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'STRINGTOOBJECT',
        signature: 'STRINGTOOBJECT(str)',
        description: 'Converts a string expression to an object.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/stringtoobject',
        snippet: 'STRINGTOOBJECT(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },

    // ── String ────────────────────────────────────────────────────────────────
    {
        name: 'CONCAT',
        signature: 'CONCAT(str1, str2 [, ...])',
        description: 'Returns a string that is the result of concatenating multiple fields from a document.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/concat',
        snippet: 'CONCAT(${1:str1}, ${2:str2})$0',
        arguments: [
            { name: 'str1', type: 'string' },
            { name: 'str2', type: 'string' },
            { name: '...', type: 'string', optional: true },
        ],
    },
    {
        name: 'CONTAINS',
        signature: 'CONTAINS(str, substr [, ignoreCase])',
        description:
            'Returns a boolean indicating whether the first string expression contains the second string expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/contains',
        snippet: 'CONTAINS(${1:str}, ${2:substr})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'substr', type: 'string' },
            { name: 'ignoreCase', type: 'boolean', optional: true },
        ],
    },
    {
        name: 'ENDSWITH',
        signature: 'ENDSWITH(str, suffix [, ignoreCase])',
        description:
            'Returns a boolean indicating whether a string ends with the specified suffix. Optionally, the comparison can be case-insensitive.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/endswith',
        snippet: 'ENDSWITH(${1:str}, ${2:suffix})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'suffix', type: 'string' },
            { name: 'ignoreCase', type: 'boolean', optional: true },
        ],
    },
    {
        name: 'INDEX_OF',
        signature: 'INDEX_OF(str, substr [, startIndex])',
        description: 'Returns the index of the first occurrence of a string.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/index-of',
        snippet: 'INDEX_OF(${1:str}, ${2:substr})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'substr', type: 'string' },
            { name: 'startIndex', type: 'number', optional: true },
        ],
    },
    {
        name: 'LEFT',
        signature: 'LEFT(str, length)',
        description: 'Returns the left part of a string up to the specified number of characters.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/left',
        snippet: 'LEFT(${1:str}, ${2:length})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'length', type: 'number' },
        ],
    },
    {
        name: 'LENGTH',
        signature: 'LENGTH(str)',
        description: 'Returns the number of characters in the specified string expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/length',
        snippet: 'LENGTH(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'LOWER',
        signature: 'LOWER(str)',
        description: 'Returns a string expression after converting uppercase character data to lowercase.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/lower',
        snippet: 'LOWER(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'LTRIM',
        signature: 'LTRIM(str)',
        description: 'Returns a string expression after it removes leading whitespace or specified characters.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/ltrim',
        snippet: 'LTRIM(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'REGEXMATCH',
        signature: 'REGEXMATCH(str, pattern [, modifiers])',
        description:
            'Returns a boolean indicating whether the provided string matches the specified regular expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/regexmatch',
        snippet: 'REGEXMATCH(${1:str}, ${2:pattern})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'pattern', type: 'string' },
            { name: 'modifiers', type: 'string', optional: true },
        ],
    },
    {
        name: 'REPLACE',
        signature: 'REPLACE(str, find, replacement)',
        description: 'Returns a string with all occurrences of a specified string replaced.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/replace',
        snippet: 'REPLACE(${1:str}, ${2:find}, ${3:replacement})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'find', type: 'string' },
            { name: 'replacement', type: 'string' },
        ],
    },
    {
        name: 'REPLICATE',
        signature: 'REPLICATE(str, count)',
        description: 'Returns a string value repeated a specific number of times.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/replicate',
        snippet: 'REPLICATE(${1:str}, ${2:count})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'count', type: 'number' },
        ],
    },
    {
        name: 'REVERSE',
        signature: 'REVERSE(str)',
        description: 'Returns the reverse order of a string value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/reverse',
        snippet: 'REVERSE(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'RIGHT',
        signature: 'RIGHT(str, length)',
        description: 'Returns the right part of a string up to the specified number of characters.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/right',
        snippet: 'RIGHT(${1:str}, ${2:length})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'length', type: 'number' },
        ],
    },
    {
        name: 'RTRIM',
        signature: 'RTRIM(str)',
        description: 'Returns a string expression after it removes trailing whitespace or specified characters.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/rtrim',
        snippet: 'RTRIM(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'STARTSWITH',
        signature: 'STARTSWITH(str, prefix [, ignoreCase])',
        description: 'Returns a boolean value indicating whether the first string expression starts with the second.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/startswith',
        snippet: 'STARTSWITH(${1:str}, ${2:prefix})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'prefix', type: 'string' },
            { name: 'ignoreCase', type: 'boolean', optional: true },
        ],
    },
    {
        name: 'STRINGEQUALS',
        signature: 'STRINGEQUALS(str1, str2 [, ignoreCase])',
        description: 'Returns a boolean indicating whether the first string expression matches the second.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/stringequals',
        snippet: 'STRINGEQUALS(${1:str1}, ${2:str2})$0',
        arguments: [
            { name: 'str1', type: 'string' },
            { name: 'str2', type: 'string' },
            { name: 'ignoreCase', type: 'boolean', optional: true },
        ],
    },
    {
        name: 'STRINGJOIN',
        signature: 'STRINGJOIN(arr, separator)',
        description:
            'Returns a string, which concatenates the elements of a specified array, using the specified separator between each element.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/stringjoin',
        snippet: 'STRINGJOIN(${1:arr}, ${2:separator})$0',
        arguments: [
            { name: 'arr', type: 'array' },
            { name: 'separator', type: 'string' },
        ],
    },
    {
        name: 'STRINGSPLIT',
        signature: 'STRINGSPLIT(str, delimiter)',
        description:
            'Returns an array of substrings obtained from separating the source string by the specified delimiter.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/stringsplit',
        snippet: 'STRINGSPLIT(${1:str}, ${2:delimiter})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'delimiter', type: 'string' },
        ],
    },
    {
        name: 'STRINGTOARRAY',
        signature: 'STRINGTOARRAY(str)',
        description: 'Converts a string expression to an array.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/stringtoarray',
        snippet: 'STRINGTOARRAY(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'STRINGTOBOOLEAN',
        signature: 'STRINGTOBOOLEAN(str)',
        description: 'Converts a string expression to a boolean.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/stringtoboolean',
        snippet: 'STRINGTOBOOLEAN(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'SUBSTRING',
        signature: 'SUBSTRING(str, startIndex, length)',
        description:
            'Returns part of a string expression starting at the specified position and of the specified length, or to the end of the string.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/substring',
        snippet: 'SUBSTRING(${1:str}, ${2:startIndex}, ${3:length})$0',
        arguments: [
            { name: 'str', type: 'string' },
            { name: 'startIndex', type: 'number' },
            { name: 'length', type: 'number' },
        ],
    },
    {
        name: 'TOSTRING',
        signature: 'TOSTRING(expr)',
        description: 'Returns a string representation of a value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/tostring',
        snippet: 'TOSTRING(${1:expr})$0',
        arguments: [{ name: 'expr', type: 'any' }],
    },
    {
        name: 'TRIM',
        signature: 'TRIM(str)',
        description:
            'Returns a string expression after it removes leading and trailing whitespace or custom characters.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/trim',
        snippet: 'TRIM(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },
    {
        name: 'UPPER',
        signature: 'UPPER(str)',
        description: 'Returns a string expression after converting lowercase character data to uppercase.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/upper',
        snippet: 'UPPER(${1:str})$0',
        arguments: [{ name: 'str', type: 'string' }],
    },

    // ── Array ─────────────────────────────────────────────────────────────────
    {
        name: 'ARRAY_CONCAT',
        signature: 'ARRAY_CONCAT(arr1, arr2 [, ...])',
        description: 'Returns an array that is the result of concatenating two or more array values.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/array-concat',
        snippet: 'ARRAY_CONCAT(${1:arr1}, ${2:arr2})$0',
        arguments: [
            { name: 'arr1', type: 'array' },
            { name: 'arr2', type: 'array' },
            { name: '...', type: 'array', optional: true },
        ],
    },
    {
        name: 'ARRAY_CONTAINS',
        signature: 'ARRAY_CONTAINS(arr, value [, partialMatch])',
        description:
            'Returns a boolean indicating whether the array contains the specified value. You can check for a partial or full match of an object by using a boolean expression within the function.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/array-contains',
        snippet: 'ARRAY_CONTAINS(${1:arr}, ${2:value})$0',
        arguments: [
            { name: 'arr', type: 'array' },
            { name: 'value', type: 'any' },
            { name: 'partialMatch', type: 'boolean', optional: true },
        ],
    },
    {
        name: 'ARRAY_CONTAINS_ALL',
        signature: 'ARRAY_CONTAINS_ALL(arr, value1, value2 [, ...])',
        description: 'Returns a boolean indicating whether the array contains all of the specified values.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/array-contains-all',
        snippet: 'ARRAY_CONTAINS_ALL(${1:arr}, ${2:value1}, ${3:value2})$0',
        arguments: [
            { name: 'arr', type: 'array' },
            { name: 'value1', type: 'any' },
            { name: 'value2', type: 'any' },
            { name: '...', type: 'any', optional: true },
        ],
    },
    {
        name: 'ARRAY_CONTAINS_ANY',
        signature: 'ARRAY_CONTAINS_ANY(arr, value1, value2 [, ...])',
        description: 'Returns a boolean indicating whether the array contains any of the specified values.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/array-contains-any',
        snippet: 'ARRAY_CONTAINS_ANY(${1:arr}, ${2:value1}, ${3:value2})$0',
        arguments: [
            { name: 'arr', type: 'array' },
            { name: 'value1', type: 'any' },
            { name: 'value2', type: 'any' },
            { name: '...', type: 'any', optional: true },
        ],
    },
    {
        name: 'ARRAY_LENGTH',
        signature: 'ARRAY_LENGTH(arr)',
        description: 'Returns the number of elements in the specified array expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/array-length',
        snippet: 'ARRAY_LENGTH(${1:arr})$0',
        arguments: [{ name: 'arr', type: 'array' }],
    },
    {
        name: 'ARRAY_SLICE',
        signature: 'ARRAY_SLICE(arr, start [, length])',
        description: 'Returns a subset of an array expression using the index and length specified.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/array-slice',
        snippet: 'ARRAY_SLICE(${1:arr}, ${2:start})$0',
        arguments: [
            { name: 'arr', type: 'array' },
            { name: 'start', type: 'any' },
            { name: 'length', type: 'number', optional: true },
        ],
    },
    {
        name: 'CHOOSE',
        signature: 'CHOOSE(index, val1, val2 [, ...])',
        description:
            'Returns the expression at the specified index of a list, or Undefined if the index exceeds the bounds of the list.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/choose',
        snippet: 'CHOOSE(${1:index}, ${2:val1}, ${3:val2})$0',
        arguments: [
            { name: 'index', type: 'number' },
            { name: 'val1', type: 'any' },
            { name: 'val2', type: 'any' },
            { name: '...', type: 'any', optional: true },
        ],
    },
    {
        name: 'OBJECTTOARRAY',
        signature: 'OBJECTTOARRAY(object)',
        description: 'Converts field/value pairs in a JSON object to a JSON array.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/objecttoarray',
        snippet: 'OBJECTTOARRAY(${1:object})$0',
        arguments: [{ name: 'object', type: 'object' }],
    },
    {
        name: 'SETINTERSECT',
        signature: 'SETINTERSECT(arr1, arr2)',
        description: 'Returns the set of expressions that is contained in both input arrays with no duplicates.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/setintersect',
        snippet: 'SETINTERSECT(${1:arr1}, ${2:arr2})$0',
        arguments: [
            { name: 'arr1', type: 'array' },
            { name: 'arr2', type: 'array' },
        ],
    },
    {
        name: 'SETUNION',
        signature: 'SETUNION(arr1, arr2)',
        description:
            'Returns a set of expressions containing all expressions from two gathered sets with no duplicates.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/setunion',
        snippet: 'SETUNION(${1:arr1}, ${2:arr2})$0',
        arguments: [
            { name: 'arr1', type: 'array' },
            { name: 'arr2', type: 'array' },
        ],
    },

    // ── Date and time ─────────────────────────────────────────────────────────
    {
        name: 'DATETIMEADD',
        signature: 'DATETIMEADD(part, number, dateTime)',
        description:
            'Returns a date and time string value that is the result of adding a specified number value to the provided date and time string.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/datetimeadd',
        snippet: 'DATETIMEADD(${1:part}, ${2:number}, ${3:dateTime})$0',
        arguments: [
            { name: 'part', type: 'string' },
            { name: 'number', type: 'any' },
            { name: 'dateTime', type: 'string' },
        ],
    },
    {
        name: 'DATETIMEBIN',
        signature: 'DATETIMEBIN(dateTime, part, binSize [, origin])',
        description:
            'Returns a date and time string value that is the result of binning (or rounding) a part of the provided date and time string.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/datetimebin',
        snippet: 'DATETIMEBIN(${1:dateTime}, ${2:part}, ${3:binSize})$0',
        arguments: [
            { name: 'dateTime', type: 'string' },
            { name: 'part', type: 'string' },
            { name: 'binSize', type: 'number' },
            { name: 'origin', type: 'string', optional: true },
        ],
    },
    {
        name: 'DATETIMEDIFF',
        signature: 'DATETIMEDIFF(part, startDateTime, endDateTime)',
        description:
            'Returns the difference, as a signed integer, of the specified date and time part between two date and time values.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/datetimediff',
        snippet: 'DATETIMEDIFF(${1:part}, ${2:startDateTime}, ${3:endDateTime})$0',
        arguments: [
            { name: 'part', type: 'string' },
            { name: 'startDateTime', type: 'string' },
            { name: 'endDateTime', type: 'string' },
        ],
    },
    {
        name: 'DATETIMEFROMPARTS',
        signature: 'DATETIMEFROMPARTS(year, month, day [, hour, minute, second, ms])',
        description:
            'Returns a date and time string value constructed from input numeric values for various date and time parts.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/datetimefromparts',
        snippet: 'DATETIMEFROMPARTS(${1:year}, ${2:month}, ${3:day})$0',
        arguments: [
            { name: 'year', type: 'number' },
            { name: 'month', type: 'number' },
            { name: 'day', type: 'number' },
            { name: 'hour', type: 'number', optional: true },
            { name: 'minute', type: 'number', optional: true },
            { name: 'second', type: 'number', optional: true },
            { name: 'ms', type: 'number', optional: true },
        ],
    },
    {
        name: 'DATETIMEPART',
        signature: 'DATETIMEPART(part, dateTime)',
        description: 'Returns the value of the specified date and time part for the provided date and time.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/datetimepart',
        snippet: 'DATETIMEPART(${1:part}, ${2:dateTime})$0',
        arguments: [
            { name: 'part', type: 'string' },
            { name: 'dateTime', type: 'string' },
        ],
    },
    {
        name: 'DATETIMETOTICKS',
        signature: 'DATETIMETOTICKS(dateTime)',
        description: 'Converts the specified DateTime to ticks.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/datetimetoticks',
        snippet: 'DATETIMETOTICKS(${1:dateTime})$0',
        arguments: [{ name: 'dateTime', type: 'string' }],
    },
    {
        name: 'DATETIMETOTIMESTAMP',
        signature: 'DATETIMETOTIMESTAMP(dateTime)',
        description:
            'Converts the specified date and time to a numeric timestamp. The timestamp is a signed numeric integer that measures the milliseconds since the Unix epoch.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/datetimetotimestamp',
        snippet: 'DATETIMETOTIMESTAMP(${1:dateTime})$0',
        arguments: [{ name: 'dateTime', type: 'string' }],
    },
    {
        name: 'GETCURRENTDATETIME',
        signature: 'GETCURRENTDATETIME()',
        description: 'Returns the current UTC (Coordinated Universal Time) date and time as an ISO 8601 string.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/getcurrentdatetime',
        snippet: 'GETCURRENTDATETIME()$0',
        arguments: [],
    },
    {
        name: 'GETCURRENTDATETIMESTATIC',
        signature: 'GETCURRENTDATETIMESTATIC()',
        description:
            'Returns the same UTC date and time value for all items in the query, as an ISO 8601 string. This is useful for consistent timestamps across query results.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/getcurrentdatetimestatic',
        snippet: 'GETCURRENTDATETIMESTATIC()$0',
        arguments: [],
    },
    {
        name: 'GETCURRENTTICKS',
        signature: 'GETCURRENTTICKS()',
        description:
            'Returns the current UTC time as the number of 100-nanosecond intervals (ticks) that have elapsed since 0001-01-01T00:00:00.0000000Z.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/getcurrentticks',
        snippet: 'GETCURRENTTICKS()$0',
        arguments: [],
    },
    {
        name: 'GETCURRENTTICKSSTATIC',
        signature: 'GETCURRENTTICKSSTATIC()',
        description:
            'Returns a static nanosecond ticks value (100-nanosecond intervals since the Unix epoch) for all items in the same partition.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/getcurrentticksstatic',
        snippet: 'GETCURRENTTICKSSTATIC()$0',
        arguments: [],
    },
    {
        name: 'GETCURRENTTIMESTAMP',
        signature: 'GETCURRENTTIMESTAMP()',
        description: 'Returns the current timestamp in milliseconds since the Unix epoch.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/getcurrenttimestamp',
        snippet: 'GETCURRENTTIMESTAMP()$0',
        arguments: [],
    },
    {
        name: 'GETCURRENTTIMESTAMPSTATIC',
        signature: 'GETCURRENTTIMESTAMPSTATIC()',
        description:
            'Returns a static timestamp value (milliseconds since the Unix epoch) for all items in the same partition.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/getcurrenttimestampstatic',
        snippet: 'GETCURRENTTIMESTAMPSTATIC()$0',
        arguments: [],
    },
    {
        name: 'TICKSTODATETIME',
        signature: 'TICKSTODATETIME(ticks)',
        description: 'Converts the specified number of ticks to a date and time value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/tickstodatetime',
        snippet: 'TICKSTODATETIME(${1:ticks})$0',
        arguments: [{ name: 'ticks', type: 'number' }],
    },
    {
        name: 'TIMESTAMPTODATETIME',
        signature: 'TIMESTAMPTODATETIME(timestamp)',
        description: 'Converts the specified timestamp to a date and time value.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/timestamptodatetime',
        snippet: 'TIMESTAMPTODATETIME(${1:timestamp})$0',
        arguments: [{ name: 'timestamp', type: 'number' }],
    },

    // ── Spatial ───────────────────────────────────────────────────────────────
    {
        name: 'ST_AREA',
        signature: 'ST_AREA(polygon)',
        description: 'Returns the total area of a GeoJSON Polygon or MultiPolygon expression.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/st-area',
        snippet: 'ST_AREA(${1:polygon})$0',
        arguments: [{ name: 'polygon', type: 'object' }],
    },
    {
        name: 'ST_DISTANCE',
        signature: 'ST_DISTANCE(point1, point2)',
        description: 'Returns the distance between two GeoJSON Point, Polygon, MultiPolygon or LineString expressions.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/st-distance',
        snippet: 'ST_DISTANCE(${1:point1}, ${2:point2})$0',
        arguments: [
            { name: 'point1', type: 'object' },
            { name: 'point2', type: 'object' },
        ],
    },
    {
        name: 'ST_INTERSECTS',
        signature: 'ST_INTERSECTS(geom1, geom2)',
        description:
            'Returns a boolean indicating whether the GeoJSON object specified in the first argument intersects the GeoJSON object in the second argument.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/st-intersects',
        snippet: 'ST_INTERSECTS(${1:geom1}, ${2:geom2})$0',
        arguments: [
            { name: 'geom1', type: 'object' },
            { name: 'geom2', type: 'object' },
        ],
    },
    {
        name: 'ST_ISVALID',
        signature: 'ST_ISVALID(geom)',
        description:
            'Returns a boolean value indicating whether the specified GeoJSON Point, Polygon, MultiPolygon, or LineString expression is valid.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/st-isvalid',
        snippet: 'ST_ISVALID(${1:geom})$0',
        arguments: [{ name: 'geom', type: 'object' }],
    },
    {
        name: 'ST_ISVALIDDETAILED',
        signature: 'ST_ISVALIDDETAILED(geom)',
        description:
            'Returns a JSON value containing a Boolean value if the specified GeoJSON Point, Polygon, or LineString expression is valid, and if invalid, the reason.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/st-isvaliddetailed',
        snippet: 'ST_ISVALIDDETAILED(${1:geom})$0',
        arguments: [{ name: 'geom', type: 'object' }],
    },
    {
        name: 'ST_WITHIN',
        signature: 'ST_WITHIN(point, polygon)',
        description:
            'Returns a boolean expression indicating whether the GeoJSON object specified in the first argument is within the GeoJSON object in the second argument.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/st-within',
        snippet: 'ST_WITHIN(${1:point}, ${2:polygon})$0',
        arguments: [
            { name: 'point', type: 'object' },
            { name: 'polygon', type: 'object' },
        ],
    },

    // ── Item ──────────────────────────────────────────────────────────────────
    {
        name: 'DOCUMENTID',
        signature: 'DOCUMENTID(item)',
        description: 'Returns the unique document ID for a given item in the container.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/documentid',
        snippet: 'DOCUMENTID(${1:item})$0',
        arguments: [{ name: 'item', type: 'any' }],
    },

    // ── Full text search ──────────────────────────────────────────────────────
    {
        name: 'FULLTEXTCONTAINS',
        signature: 'FULLTEXTCONTAINS(propertyPath, keyword)',
        description:
            'Returns a boolean indicating whether the keyword string expression is contained in a specified property path.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/fulltextcontains',
        snippet: 'FULLTEXTCONTAINS(${1:propertyPath}, ${2:keyword})$0',
        arguments: [
            { name: 'propertyPath', type: 'string' },
            { name: 'keyword', type: 'string' },
        ],
    },
    {
        name: 'FULLTEXTCONTAINSALL',
        signature: 'FULLTEXTCONTAINSALL(propertyPath, keyword1, keyword2 [, ...])',
        description:
            'Returns a boolean indicating whether all of the provided string expressions are contained in a specified property path.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/fulltextcontainsall',
        snippet: 'FULLTEXTCONTAINSALL(${1:propertyPath}, ${2:keyword1}, ${3:keyword2})$0',
        arguments: [
            { name: 'propertyPath', type: 'string' },
            { name: 'keyword1', type: 'string' },
            { name: 'keyword2', type: 'string' },
            { name: '...', type: 'string', optional: true },
        ],
    },
    {
        name: 'FULLTEXTCONTAINSANY',
        signature: 'FULLTEXTCONTAINSANY(propertyPath, keyword1, keyword2 [, ...])',
        description:
            'Returns a boolean indicating whether any of the provided string expressions are contained in a specified property path.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/fulltextcontainsany',
        snippet: 'FULLTEXTCONTAINSANY(${1:propertyPath}, ${2:keyword1}, ${3:keyword2})$0',
        arguments: [
            { name: 'propertyPath', type: 'string' },
            { name: 'keyword1', type: 'string' },
            { name: 'keyword2', type: 'string' },
            { name: '...', type: 'string', optional: true },
        ],
    },
    {
        name: 'FULLTEXTSCORE',
        signature: 'FULLTEXTSCORE(propertyPath, keyword1 [, keyword2, ...])',
        description:
            'Returns a BM25 score value that can only be used in an ORDER BY RANK clause to sort results from highest relevancy to lowest relevancy of the specified terms.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/fulltextscore',
        snippet: 'FULLTEXTSCORE(${1:propertyPath}, ${2:keyword1})$0',
        arguments: [
            { name: 'propertyPath', type: 'string' },
            { name: 'keyword1', type: 'string' },
            { name: 'keyword2', type: 'string', optional: true },
        ],
    },
    {
        name: 'RRF',
        signature: 'RRF(score1, score2 [, ...])',
        description: 'Returns a fused score by combining two or more scores provided by other functions.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/rrf',
        snippet: 'RRF(${1:score1}, ${2:score2})$0',
        arguments: [
            { name: 'score1', type: 'any' },
            { name: 'score2', type: 'any' },
            { name: '...', type: 'any', optional: true },
        ],
    },

    // ── Conditional ──────────────────────────────────────────────────────────
    {
        name: 'IIF',
        signature: 'IIF(condition, trueValue, falseValue)',
        description:
            'Returns one of two values, depending on whether the Boolean expression evaluates to true or false.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/iif',
        snippet: 'IIF(${1:condition}, ${2:trueValue}, ${3:falseValue})$0',
        arguments: [
            { name: 'condition', type: 'boolean' },
            { name: 'trueValue', type: 'any' },
            { name: 'falseValue', type: 'any' },
        ],
    },

    // ── Vector ────────────────────────────────────────────────────────────────
    {
        name: 'VECTORDISTANCE',
        signature: 'VECTORDISTANCE(vector1, vector2 [, distanceType, bruteForce])',
        description: 'Returns the similarity score between two specified vectors.',
        link: 'https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance',
        snippet: 'VECTORDISTANCE(${1:vector1}, ${2:vector2})$0',
        arguments: [
            { name: 'vector1', type: 'array' },
            { name: 'vector2', type: 'array' },
            { name: 'distanceType', type: 'string', optional: true },
            { name: 'bruteForce', type: 'boolean', optional: true },
        ],
    },
];
/**
 * Function names only — for use in syntax highlighting token matchers.
 */
export const NOSQL_FUNCTION_NAMES: readonly string[] = NOSQL_FUNCTIONS.map((f) => f.name);

/**
 * Names of aggregate functions (for boosting in SELECT when GROUP BY is present).
 */
export const NOSQL_AGGREGATE_FUNCTION_NAMES: ReadonlySet<string> = new Set(['AVG', 'COUNT', 'MAX', 'MIN', 'SUM']);

// ─── Language configuration (shared between VS Code and Monaco) ────────────────

/**
 * Language configuration for the CosmosDB NoSQL query language.
 *
 * This is the shared source of truth for bracket matching, comment toggling,
 * auto-closing pairs, and surrounding pairs. It mirrors `language-configuration.json`
 * (used by VS Code natively) and is consumed by the Monaco editor in the webview.
 *
 * Note: `language-configuration.json` is loaded declaratively by VS Code and cannot
 * import from TypeScript modules, so it must remain a separate JSON file. Keep the
 * two in sync manually if this structure ever changes.
 */
export const NOSQL_LANGUAGE_CONFIGURATION = {
    comments: {
        lineComment: '--',
        blockComment: ['/*', '*/'] as [string, string],
    },
    brackets: [
        ['[', ']'],
        ['(', ')'],
    ] as [string, string][],
    autoClosingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"', notIn: ['string', 'comment'] },
        { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
    ],
};
