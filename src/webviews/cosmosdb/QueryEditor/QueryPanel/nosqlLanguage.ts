/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CosmosDB NoSQL language definition for Monaco Editor.
 *
 * Provides syntax highlighting (Monarch tokenizer) and language configuration
 * (brackets, comments, auto-closing pairs) for the CosmosDB NoSQL query language.
 *
 * Reference: https://learn.microsoft.com/azure/cosmos-db/nosql/query/
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export const NOSQL_LANGUAGE_ID = 'nosql';

/**
 * Language configuration for bracket matching, comments, and auto-closing pairs.
 */
export const nosqlLanguageConfiguration: monaco.languages.LanguageConfiguration = {
    comments: {
        lineComment: '--',
        blockComment: ['/*', '*/'],
    },
    brackets: [
        ['[', ']'],
        ['(', ')'],
    ],
    autoClosingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
    ],
    surroundingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
    ],
};

/**
 * Monarch tokenizer for CosmosDB NoSQL query language.
 *
 * Covers:
 * - SQL-like clauses: SELECT, FROM, WHERE, ORDER BY, GROUP BY, etc.
 * - CosmosDB-specific keywords: VALUE, UNDEFINED, BETWEEN, EXISTS, ARRAY, UDF, etc.
 * - Built-in scalar, aggregate, mathematical, string, type-checking, date/time,
 *   array, spatial, and object functions.
 * - Operators, numbers, strings, identifiers, and quoted identifiers.
 */
export const nosqlMonarchTokensProvider: monaco.languages.IMonarchLanguage = {
    defaultToken: '',
    ignoreCase: true,
    tokenPostfix: '.nosql',

    // SQL-like keywords and CosmosDB-specific keywords
    keywords: [
        // Clauses
        'SELECT',
        'DISTINCT',
        'TOP',
        'FROM',
        'WHERE',
        'ORDER',
        'BY',
        'ASC',
        'DESC',
        'GROUP',
        'HAVING',
        'OFFSET',
        'LIMIT',
        'JOIN',
        'IN',
        'AS',

        // CosmosDB-specific
        'VALUE',
        'EXISTS',
        'BETWEEN',
        'LIKE',
        'ARRAY',
        'UDF',

        // Logical
        'AND',
        'OR',
        'NOT',

        // Literals
        'NULL',
        'TRUE',
        'FALSE',
        'UNDEFINED',
    ],

    // Built-in functions (highlighting as support functions)
    builtinFunctions: [
        // Aggregate functions
        'AVG',
        'COUNT',
        'MAX',
        'MIN',
        'SUM',

        // Mathematical functions
        'ABS',
        'ACOS',
        'ASIN',
        'ATAN',
        'ATN2',
        'CEILING',
        'COS',
        'COT',
        'DEGREES',
        'EXP',
        'FLOOR',
        'LOG',
        'LOG10',
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
        'NumberBin',
        'IntAdd',
        'IntBitAnd',
        'IntBitLeftShift',
        'IntBitNot',
        'IntBitOr',
        'IntBitRightShift',
        'IntBitXor',
        'IntDiv',
        'IntMod',
        'IntMul',
        'IntSub',

        // Type checking functions
        'IS_ARRAY',
        'IS_BOOL',
        'IS_DEFINED',
        'IS_FINITE_NUMBER',
        'IS_INTEGER',
        'IS_NULL',
        'IS_NUMBER',
        'IS_OBJECT',
        'IS_PRIMITIVE',
        'IS_STRING',

        // String functions
        'CONCAT',
        'CONTAINS',
        'ENDSWITH',
        'INDEX_OF',
        'LEFT',
        'LENGTH',
        'LOWER',
        'LTRIM',
        'REGEXMATCH',
        'REPLACE',
        'REPLICATE',
        'REVERSE',
        'RIGHT',
        'RTRIM',
        'STARTSWITH',
        'StringEquals',
        'SUBSTRING',
        'ToString',
        'TRIM',
        'UPPER',

        // Array functions
        'ARRAY_CONCAT',
        'ARRAY_CONTAINS',
        'ARRAY_LENGTH',
        'ARRAY_SLICE',
        'SetIntersect',
        'SetUnion',

        // Date/time functions
        'DateTimeAdd',
        'DateTimeBin',
        'DateTimeDiff',
        'DateTimeFromParts',
        'DateTimePart',
        'DateTimeToTicks',
        'DateTimeToTimestamp',
        'GetCurrentDateTime',
        'GetCurrentDateTimeStatic',
        'GetCurrentTicks',
        'GetCurrentTicksStatic',
        'GetCurrentTimestamp',
        'GetCurrentTimestampStatic',
        'TicksToDateTime',

        // Spatial functions
        'ST_AREA',
        'ST_DISTANCE',
        'ST_INTERSECTS',
        'ST_ISVALID',
        'ST_ISVALIDDETAILED',
        'ST_WITHIN',

        // Object functions
        'ObjectToArray',
        'AllMembers',

        // Conversion functions
        'StringToArray',
        'StringToBoolean',
        'StringToNull',
        'StringToNumber',
        'StringToObject',

        // Vector functions
        'VectorDistance',
    ],

    operators: ['=', '>', '<', '!', '~', '?', ':', '!=', '<>', '<=', '>=', '||', '??'],

    tokenizer: {
        root: [
            // Whitespace
            { include: '@whitespace' },

            // Quoted identifiers: c["property-name"]
            [/"/, 'string.quoted', '@quotedIdentifier'],

            // Single-quoted strings
            [/'/, 'string', '@singleQuotedString'],

            // Numbers (integer and float)
            [/\d+(\.\d+)?([eE][-+]?\d+)?/, 'number'],

            // Delimiters and operators
            [/[()[\]]/, '@brackets'],
            [/[,;.]/, 'delimiter'],

            // Operators
            [/[<>!=]=?|[?:|~]|\|\||&&|\?\?/, 'operator'],
            [/[+\-*/%&]/, 'operator'],

            // Identifiers and keywords
            [
                /[a-zA-Z_]\w*/,
                {
                    cases: {
                        '@keywords': 'keyword',
                        '@builtinFunctions': 'support.function',
                        '@default': 'identifier',
                    },
                },
            ],
        ],

        whitespace: [
            [/\s+/, 'white'],
            [/--.*$/, 'comment'],
            [/\/\*/, 'comment', '@blockComment'],
        ],

        blockComment: [
            [/[^/*]+/, 'comment'],
            [/\*\//, 'comment', '@pop'],
            [/[/*]/, 'comment'],
        ],

        quotedIdentifier: [
            [/[^"\\]+/, 'string.quoted'],
            [/\\./, 'string.escape'],
            [/"/, 'string.quoted', '@pop'],
        ],

        singleQuotedString: [
            [/[^'\\]+/, 'string'],
            [/\\./, 'string.escape'],
            [/''/, 'string.escape'],
            [/'/, 'string', '@pop'],
        ],
    },
};

/**
 * Registers the CosmosDB NoSQL language with Monaco.
 * Call once when Monaco is available. Idempotent — safe to call multiple times.
 */
export function registerNoSqlLanguage(monacoInstance: typeof monaco): void {
    // Check if the language is already registered
    const languages = monacoInstance.languages.getLanguages();
    if (languages.some((lang) => lang.id === NOSQL_LANGUAGE_ID)) {
        return;
    }

    monacoInstance.languages.register({
        id: NOSQL_LANGUAGE_ID,
        extensions: ['.nosql'],
        aliases: ['CosmosDB NoSQL', 'nosql'],
    });

    monacoInstance.languages.setLanguageConfiguration(NOSQL_LANGUAGE_ID, nosqlLanguageConfiguration);
    monacoInstance.languages.setMonarchTokensProvider(NOSQL_LANGUAGE_ID, nosqlMonarchTokensProvider);
}
