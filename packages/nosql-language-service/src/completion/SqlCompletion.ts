/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Autocomplete for CosmosDB NoSQL SQL
//
// Takes a query string, cursor offset, and JSON Schema of the collection.
// Returns completion items suitable for mapping to Monaco CompletionItems.
// ---------------------------------------------------------------------------

import { type JSONSchema } from '@cosmosdb/schema-analyzer';
import { type IToken, type TokenType } from 'chevrotain';
import { SqlLexer } from '../lexer/SqlLexer.js';
import * as T from '../lexer/tokens.js';

/** Re-export for consumers that import from this module */
export type { JSONSchema };

// ========================== Public types ====================================

export type CompletionItemKind = 'keyword' | 'field' | 'function' | 'snippet' | 'parameter' | 'alias';

export interface CompletionItem {
    label: string;
    kind: CompletionItemKind;
    detail?: string;
    sortText?: string;
    insertText?: string;
}

export interface CompletionRequest {
    /** The full query string (maybe incomplete / invalid) */
    query: string;
    /** 0-based cursor offset in the query string */
    offset: number;
    /** JSON Schema of the collection (with x-extensions) */
    schema?: JSONSchema;
    /** Known collection aliases from `FROM` clause (e.g. ["c", "t"]) — auto-detected if not provided */
    aliases?: string[];
}

// ========================== Built-in functions ==============================
// Source: SqlStringTokens.txt — "System Built-in Functions" section.
// Uses the underscore-separated canonical forms (ARRAY_LENGTH not ARRAYLENGTH).
// Grouped by category for priority ranking.

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
const FUNCTION_CATEGORIES: [string, string[], number][] = [
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BUILTIN_FUNCTIONS: string[] = FUNCTION_CATEGORIES.flatMap(([, fns]) => fns);

// ========================== Keyword groups ==================================

const CLAUSE_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'OFFSET', 'LIMIT', 'JOIN', 'IN', 'AS'];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SELECT_MODIFIERS = ['DISTINCT', 'TOP', 'VALUE'];

const EXPRESSION_KEYWORDS = [
    'AND',
    'OR',
    'NOT',
    'BETWEEN',
    'LIKE',
    'IN',
    'EXISTS',
    'ARRAY',
    'IS',
    'NULL',
    'UNDEFINED',
    'TRUE',
    'FALSE',
    'ASC',
    'DESC',
];

// ========================== Context detection ================================

enum CompletionContext {
    /** Start of query or after semicolon */
    QueryStart,
    /** Right after SELECT keyword */
    AfterSelect,
    /** Inside SELECT list (after first item) */
    InSelectList,
    /** Right after FROM keyword */
    AfterFrom,
    /** After FROM alias, expecting clause keyword */
    AfterFromClause,
    /** Right after WHERE keyword */
    AfterWhere,
    /** Inside WHERE expression */
    InWhereExpression,
    /** After a dot (property access) */
    AfterDot,
    /** After ORDER keyword */
    AfterOrder,
    /** After GROUP keyword */
    AfterGroup,
    /** After ORDER BY / GROUP BY */
    AfterOrderBy,
    /** General expression position */
    InExpression,
    /** Inside function call parens */
    InFunctionArgs,
    /** Unknown / fallback */
    Unknown,
}

interface CursorContext {
    context: CompletionContext;
    /** The token immediately before the cursor */
    prevToken?: IToken;
    /** The prefix the user is typing (for filtering), e.g. "c.na" → dotPrefix="c", fieldPrefix="na" */
    dotPrefix?: string;
    /** Partial text being typed */
    typingPrefix: string;
    /** Detected aliases from `FROM` clause */
    aliases: string[];
}

function detectContext(query: string, offset: number): CursorContext {
    const lexResult = SqlLexer.tokenize(query);
    const tokens = lexResult.tokens;

    // Find the text being typed at cursor position
    let typingPrefix = '';
    const textBeforeCursor = query.substring(0, offset);
    const trailingMatch = textBeforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
    if (trailingMatch) {
        typingPrefix = trailingMatch[0];
    }

    // Find which token the cursor is in or right after
    let tokenBeforeCursor: IToken | undefined;
    let tokenBeforePrev: IToken | undefined;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startOffset >= offset) break;
        tokenBeforePrev = tokenBeforeCursor;
        tokenBeforeCursor = t;
    }

    // Detect aliases from `FROM` clause
    const aliases = detectAliases(tokens);

    // Check for dot context: "c." or "c.na"
    const dotMatch = textBeforeCursor.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)?$/);
    if (dotMatch) {
        return {
            context: CompletionContext.AfterDot,
            prevToken: tokenBeforeCursor,
            dotPrefix: dotMatch[1],
            typingPrefix: dotMatch[2] ?? '',
            aliases,
        };
    }

    if (!tokenBeforeCursor) {
        return { context: CompletionContext.QueryStart, typingPrefix, aliases };
    }

    const prevType = tokenBeforeCursor.tokenType;

    // Determine context from the previous token
    if (prevType === T.Select) {
        return { context: CompletionContext.AfterSelect, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.From) {
        return { context: CompletionContext.AfterFrom, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Where) {
        return { context: CompletionContext.AfterWhere, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Order) {
        return { context: CompletionContext.AfterOrder, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Group) {
        return { context: CompletionContext.AfterGroup, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.By) {
        return { context: CompletionContext.AfterOrderBy, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Comma) {
        // Figure out what clause we're in by scanning backwards
        const clause = findEnclosingClause(tokens, tokenBeforeCursor);
        if (clause === 'SELECT')
            return { context: CompletionContext.InSelectList, prevToken: tokenBeforeCursor, typingPrefix, aliases };
        if (clause === 'ORDER BY')
            return { context: CompletionContext.AfterOrderBy, prevToken: tokenBeforeCursor, typingPrefix, aliases };
        return { context: CompletionContext.InExpression, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.Dot) {
        return { context: CompletionContext.AfterDot, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }

    // After clause-ending tokens (identifier after FROM, etc.) — suggest next clause
    if (isIdentifierLike(prevType)) {
        // Check if we're right after FROM alias
        if (tokenBeforePrev?.tokenType === T.From || tokenBeforePrev?.tokenType === T.As) {
            return { context: CompletionContext.AfterFromClause, prevToken: tokenBeforeCursor, typingPrefix, aliases };
        }
        // Check if preceding context is a comparison/operator → expression
        return { context: CompletionContext.InExpression, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (isOperator(prevType)) {
        return { context: CompletionContext.InExpression, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }
    if (prevType === T.LParen) {
        return { context: CompletionContext.InFunctionArgs, prevToken: tokenBeforeCursor, typingPrefix, aliases };
    }

    return { context: CompletionContext.Unknown, prevToken: tokenBeforeCursor, typingPrefix, aliases };
}

function detectAliases(tokens: IToken[]): string[] {
    const aliases: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].tokenType === T.From && i + 1 < tokens.length && isIdentifierLike(tokens[i + 1].tokenType)) {
            const collection = tokens[i + 1].image;
            // Check for AS alias
            if (i + 2 < tokens.length && tokens[i + 2].tokenType === T.As && i + 3 < tokens.length) {
                aliases.push(tokens[i + 3].image);
            } else if (
                i + 2 < tokens.length &&
                isIdentifierLike(tokens[i + 2].tokenType) &&
                !isClauseKeyword(tokens[i + 2].tokenType)
            ) {
                aliases.push(tokens[i + 2].image);
            } else {
                aliases.push(collection);
            }
        }
        // Iterator: x IN collection
        if (tokens[i].tokenType === T.In && i - 1 >= 0 && isIdentifierLike(tokens[i - 1].tokenType)) {
            aliases.push(tokens[i - 1].image);
        }
    }
    return [...new Set(aliases)];
}

function findEnclosingClause(tokens: IToken[], comma: IToken): string {
    for (let i = tokens.indexOf(comma); i >= 0; i--) {
        if (tokens[i].tokenType === T.Select) return 'SELECT';
        if (tokens[i].tokenType === T.By) return 'ORDER BY';
        if (tokens[i].tokenType === T.Where) return 'WHERE';
    }
    return 'UNKNOWN';
}

function isIdentifierLike(type: TokenType): boolean {
    return type === T.Identifier || type === T.Let || type === T.Rank || type === T.Left || type === T.Right;
}

function isClauseKeyword(type: TokenType): boolean {
    return (
        type === T.Where ||
        type === T.Order ||
        type === T.Group ||
        type === T.Join ||
        type === T.Offset ||
        type === T.Limit
    );
}

function isOperator(type: TokenType): boolean {
    return (
        type === T.Equals ||
        type === T.NotEqual ||
        type === T.LessThan ||
        type === T.GreaterThan ||
        type === T.LessThanEqual ||
        type === T.GreaterThanEqual ||
        type === T.Plus ||
        type === T.Minus ||
        type === T.Star ||
        type === T.Slash ||
        type === T.And ||
        type === T.Or
    );
}

// ========================== Schema field extraction ===========================

function getFieldsFromSchema(schema: JSONSchema | undefined, path: string[]): CompletionItem[] {
    if (!schema?.properties) return [];

    // Navigate to the right level
    let current: JSONSchema = schema;
    for (const segment of path) {
        const prop = current.properties?.[segment];
        if (!prop || typeof prop === 'boolean') return [];
        current = prop as JSONSchema;
        // If it's an array, look at items
        if (current.type === 'array' && current.items && !Array.isArray(current.items)) {
            current = current.items as JSONSchema;
        }
    }

    if (!current.properties) return [];

    return Object.entries(current.properties).map(([name, propSchema]) => {
        const ps = propSchema as JSONSchema;
        const occurrence = ps['x-occurrence'] ?? 0;
        const type = Array.isArray(ps.type) ? ps.type[0] : (ps.type ?? 'unknown');
        return {
            label: name,
            kind: 'field' as const,
            detail: type,
            // Sort by occurrence descending — pad with leading zeros for lexicographic sort
            sortText: String(1000 - occurrence).padStart(4, '0') + name,
        };
    });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getTopLevelFields(schema: JSONSchema | undefined): CompletionItem[] {
    return getFieldsFromSchema(schema, []);
}

// ========================== Main entry point ==================================

export function getCompletions(request: CompletionRequest): CompletionItem[] {
    const { query, offset, schema, aliases: userAliases } = request;
    const ctx = detectContext(query, offset);
    const aliases = userAliases ?? ctx.aliases;

    const items: CompletionItem[] = [];

    switch (ctx.context) {
        case CompletionContext.QueryStart:
            items.push(kwp('SELECT', 1));
            break;

        case CompletionContext.AfterSelect:
            // Most common: * and aliases (to type c.field), then modifiers
            items.push({ label: '*', kind: 'keyword', sortText: '0001*' });
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0002' + alias });
            }
            items.push(kwp('TOP', 10)); // very common modifier
            items.push(kwp('DISTINCT', 15)); // common modifier
            items.push(kwp('VALUE', 20)); // less common
            items.push(...functionItems(50)); // functions lower priority
            break;

        case CompletionContext.InSelectList:
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0001' + alias });
            }
            items.push(...functionItems(20));
            break;

        case CompletionContext.AfterFrom:
            // Nothing useful from schema here — user types collection name
            break;

        case CompletionContext.AfterFromClause:
            // Ordered by frequency in real queries
            items.push(kwp('WHERE', 1)); // most common after FROM
            items.push(kwp('ORDER BY', 5));
            items.push(kwp('JOIN', 10));
            items.push(kwp('GROUP BY', 15));
            items.push(kwp('OFFSET', 20));
            break;

        case CompletionContext.AfterWhere:
        case CompletionContext.InWhereExpression:
        case CompletionContext.InExpression:
        case CompletionContext.InFunctionArgs:
            // In expression: aliases first, then keywords, then functions
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0001' + alias });
            }
            items.push(...expressionKeywordsRanked());
            items.push(...functionItems(30));
            break;

        case CompletionContext.AfterDot: {
            // "c." → suggest fields from schema
            const fullDotExpr = extractDotExpression(query, offset);
            const parts = fullDotExpr.split('.');
            const rootAlias = parts[0];
            const path = parts.slice(1, -1); // segments between root alias and cursor

            // Suggest schema fields if root matches a known alias, OR if no
            // FROM clause has been typed yet (user is still composing the query).
            if (aliases.includes(rootAlias) || aliases.length === 0) {
                items.push(...getFieldsFromSchema(schema, path));
            }
            break;
        }

        case CompletionContext.AfterOrder:
            items.push(kwp('BY', 1));
            break;

        case CompletionContext.AfterGroup:
            items.push(kwp('BY', 1));
            break;

        case CompletionContext.AfterOrderBy:
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0001' + alias });
            }
            break;

        case CompletionContext.Unknown:
            // Fallback: clause keywords (ranked), then aliases, then functions
            items.push(kwp('SELECT', 1));
            items.push(kwp('WHERE', 5));
            items.push(kwp('FROM', 8));
            items.push(kwp('ORDER BY', 10));
            items.push(kwp('GROUP BY', 15));
            items.push(kwp('JOIN', 18));
            items.push(kwp('OFFSET', 20));
            items.push(kwp('LIMIT', 22));
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0030' + alias });
            }
            items.push(...functionItems(50));
            break;
    }

    // Filter by typing prefix
    const prefix = ctx.typingPrefix.toLowerCase();
    if (prefix) {
        return items.filter((item) => item.label.toLowerCase().startsWith(prefix));
    }
    return items;
}

// ========================== Helpers ==========================================

function extractDotExpression(query: string, offset: number): string {
    const before = query.substring(0, offset);
    const match = before.match(/([a-zA-Z_][a-zA-Z0-9_.]*\.?)$/);
    return match ? match[1] : '';
}

function kw(label: string): CompletionItem {
    return { label, kind: 'keyword', sortText: '0200' + label };
}

/** Keyword with explicit priority (lower = higher in list) */
function kwp(label: string, priority: number): CompletionItem {
    return { label, kind: 'keyword', sortText: String(priority).padStart(4, '0') + label };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function clauseKeywords(): CompletionItem[] {
    return CLAUSE_KEYWORDS.map(kw);
}

/** Expression keywords ranked by frequency of use in real queries */
function expressionKeywordsRanked(): CompletionItem[] {
    // Ordered by how commonly used in WHERE/expressions
    const ranked: [string, number][] = [
        ['AND', 5],
        ['OR', 8],
        ['NOT', 12],
        ['IN', 15],
        ['BETWEEN', 20],
        ['LIKE', 22],
        ['EXISTS', 25],
        ['IS', 28],
        ['NULL', 30],
        ['TRUE', 32],
        ['FALSE', 33],
        ['UNDEFINED', 35],
        ['ASC', 40],
        ['DESC', 41],
        ['ARRAY', 45],
    ];
    return ranked.map(([label, priority]) => kwp(label, priority));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function expressionKeywords(): CompletionItem[] {
    return EXPRESSION_KEYWORDS.map(kw);
}

function functionItems(basePriority: number = 30): CompletionItem[] {
    const items: CompletionItem[] = [];
    for (const [category, fns, catPriority] of FUNCTION_CATEGORIES) {
        for (let i = 0; i < fns.length; i++) {
            const name = fns[i];
            items.push({
                label: name,
                kind: 'function' as const,
                detail: category,
                insertText: name + '($0)',
                sortText: String(basePriority + catPriority + i).padStart(4, '0') + name,
            });
        }
    }
    return items;
}
