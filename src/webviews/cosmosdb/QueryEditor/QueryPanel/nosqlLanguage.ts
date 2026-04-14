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
    NOSQL_LANGUAGE_CONFIGURATION,
    NOSQL_LANGUAGE_ID,
    NOSQL_OPERATOR_TOKENS,
} from '../../../../cosmosdb/language/nosqlLanguageDefinitions';

export { NOSQL_LANGUAGE_ID } from '../../../../cosmosdb/language/nosqlLanguageDefinitions';

/**
 * Language configuration for bracket matching, comments, and auto-closing pairs.
 * Derived from the shared constant in nosqlLanguageDefinitions — same source of truth
 * as `language-configuration.json` used by the VS Code editor.
 */
export const nosqlLanguageConfiguration: monaco.languages.LanguageConfiguration = NOSQL_LANGUAGE_CONFIGURATION;

/**
 * Monarch tokenizer for CosmosDB NoSQL query language.
 *
 * Covers:
 * - SQL-like clauses: SELECT, FROM, WHERE, ORDER BY, GROUP BY, etc.
 * - CosmosDB-specific keywords: VALUE, UNDEFINED, BETWEEN, EXISTS, RANK, etc.
 * - Built-in scalar, aggregate, mathematical, string, type-checking, date/time,
 *   array, spatial, object, full-text search, and vector functions.
 * - Operators, hex/float/integer numbers, strings, identifiers, and quoted identifiers.
 */
export const nosqlMonarchTokensProvider: monaco.languages.IMonarchLanguage = {
    defaultToken: '',
    ignoreCase: true,
    tokenPostfix: '.nosql',

    // Explicit bracket token names (used by Monarch's @brackets reference)
    brackets: [
        { open: '[', close: ']', token: 'delimiter.square' },
        { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],

    // SQL-like keywords and CosmosDB-specific keywords (from shared module)
    keywords: [...NOSQL_KEYWORD_TOKENS],

    // Word-based operators: AND, OR, NOT, BETWEEN, IN, LIKE, EXISTS (from shared module)
    // Checked before keywords so themes can color them differently.
    operators: [...NOSQL_OPERATOR_TOKENS],

    // Built-in functions (from shared module)
    builtinFunctions: [...NOSQL_FUNCTION_NAMES],

    tokenizer: {
        root: [
            // Comments (checked before whitespace so inline `--` is caught)
            { include: '@comments' },

            // Whitespace
            { include: '@whitespace' },

            // Numbers (hex, float and integer, scientific notation)
            { include: '@numbers' },

            // Strings (single-quoted) and quoted identifiers (double-quoted)
            { include: '@strings' },

            // Brackets and delimiters
            [/[()[\]]/, '@brackets'],
            [/[,;.]/, 'delimiter'],

            // Operators: comparison (= != <> < > <= >=) and null coalescing (??)
            [/[<>]=?|!=|<>|\?\?/, 'operator'],
            // Arithmetic: + - * / %
            [/[+\-*/%]/, 'operator'],

            // Identifiers and keywords
            [
                /[a-zA-Z_]\w*/,
                {
                    cases: {
                        '@operators': 'operator',
                        '@keywords': 'keyword',
                        '@builtinFunctions': 'support.function',
                        '@default': 'identifier',
                    },
                },
            ],
        ],

        // ── Comments ──────────────────────────────────────────────────────────
        comments: [
            [/--+.*$/, 'comment'],
            [/\/\*/, 'comment', '@blockComment'],
        ],

        blockComment: [
            [/[^*/]+/, 'comment'],
            [/\*\//, 'comment', '@pop'],
            [/[*/]/, 'comment'],
        ],

        // ── Whitespace ────────────────────────────────────────────────────────
        whitespace: [[/\s+/, 'white']],

        // ── Numbers ───────────────────────────────────────────────────────────
        numbers: [
            // Hexadecimal: 0x1A2B
            [/0[xX][0-9a-fA-F]+/, 'number.hex'],
            // Float / scientific notation: 3.14, 1e10, 2.5E-3
            [/\d+\.\d*([eE][-+]?\d+)?/, 'number.float'],
            [/\d+[eE][-+]?\d+/, 'number.float'],
            // Integer
            [/\d+/, 'number'],
        ],

        // ── Strings ───────────────────────────────────────────────────────────
        strings: [
            // Double-quoted identifier: c["property-name"]
            [/"/, 'string.quoted', '@quotedIdentifier'],
            // Single-quoted string literal
            [/'/, 'string', '@singleQuotedString'],
        ],

        quotedIdentifier: [
            [/[^"\\]+/, 'string.quoted'],
            [/\\./, 'string.escape'],
            [/"/, 'string.quoted', '@pop'],
        ],

        singleQuotedString: [
            [/[^'\\]+/, 'string'],
            [/\\./, 'string.escape'],
            [/''/, 'string.escape'], // SQL-style escaped single quote
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
