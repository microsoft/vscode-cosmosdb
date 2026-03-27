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
import {
    NOSQL_FUNCTION_NAMES,
    NOSQL_KEYWORD_TOKENS,
    NOSQL_LANGUAGE_ID,
} from '../../../../cosmosdb/language/nosqlLanguageDefinitions';

export { NOSQL_LANGUAGE_ID } from '../../../../cosmosdb/language/nosqlLanguageDefinitions';

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

    // SQL-like keywords and CosmosDB-specific keywords (from shared module)
    keywords: [...NOSQL_KEYWORD_TOKENS],

    // Built-in functions (from shared module)
    builtinFunctions: [...NOSQL_FUNCTION_NAMES],

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
