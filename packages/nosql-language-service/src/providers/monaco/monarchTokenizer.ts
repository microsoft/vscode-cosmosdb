/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { SQL_KEYWORDS } from '../../lexer/tokens.js';
import { FUNCTION_SIGNATURES } from '../../services/index.js';

/** Word-based operators (checked before keywords so themes can color them differently). */
const MONARCH_OPERATORS = ['AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'LIKE', 'EXISTS'];

/** Built-in function names, derived from the language service's function signatures. */
const MONARCH_BUILTIN_FUNCTIONS = Object.keys(FUNCTION_SIGNATURES);

/**
 * Monaco language configuration for bracket matching, comments, and auto-closing pairs.
 */
export const cosmosDbSqlLanguageConfiguration: monacoEditor.languages.LanguageConfiguration = {
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

/**
 * Monarch tokenizer for CosmosDB NoSQL query language.
 */
export const cosmosDbSqlMonarchTokensProvider: monacoEditor.languages.IMonarchLanguage = {
    defaultToken: '',
    ignoreCase: true,
    tokenPostfix: '.nosql',

    brackets: [
        { open: '[', close: ']', token: 'delimiter.square' },
        { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],

    keywords: [...SQL_KEYWORDS],
    operators: [...MONARCH_OPERATORS],
    builtinFunctions: [...MONARCH_BUILTIN_FUNCTIONS],

    tokenizer: {
        root: [
            { include: '@comments' },
            { include: '@whitespace' },
            { include: '@numbers' },
            { include: '@strings' },

            [/[()[\]]/, '@brackets'],
            [/[,;.]/, 'delimiter'],

            [/>>>|>>|<<|\|\||[<>]=?|!=|<>|\?\?/, 'operator'],
            [/[+\-*/%&|^~]/, 'operator'],

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

        comments: [
            [/--+.*$/, 'comment'],
            [/\/\*/, 'comment', '@blockComment'],
        ],

        blockComment: [
            [/[^*/]+/, 'comment'],
            [/\*\//, 'comment', '@pop'],
            [/[*/]/, 'comment'],
        ],

        whitespace: [[/\s+/, 'white']],

        numbers: [
            [/0[xX][0-9a-fA-F]+/, 'number.hex'],
            [/\d+\.\d*([eE][-+]?\d+)?/, 'number.float'],
            [/\d+[eE][-+]?\d+/, 'number.float'],
            [/\d+/, 'number'],
        ],

        strings: [
            [/"/, 'string.quoted', '@quotedIdentifier'],
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
            [/''/, 'string.escape'],
            [/'/, 'string', '@pop'],
        ],
    },
};

