/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type StreamParser, type StringStream } from '@codemirror/language';
import { SQL_KEYWORDS } from '../../lexer/tokens.js';
import { FUNCTION_SIGNATURES } from '../../services/index.js';

const CM_OPERATORS = new Set(['AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'LIKE', 'EXISTS']);
const CM_BUILTINS = new Set(Object.keys(FUNCTION_SIGNATURES).map((n) => n.toUpperCase()));
const CM_KEYWORDS = new Set(SQL_KEYWORDS.map((k) => k.toUpperCase()));

interface NoSqlTokenState {
    context: string;
}

/**
 * A CodeMirror 6 `StreamParser` for CosmosDB NoSQL query syntax.
 * Compatible with `StreamLanguage.define()`.
 */
export const cosmosDbSqlStreamParser: StreamParser<NoSqlTokenState> = {
    name: 'cosmosdb-sql',

    startState(): NoSqlTokenState {
        return { context: 'top' };
    },

    token(stream: StringStream, state: NoSqlTokenState): string | null {
        // Block comment continuation
        if (state.context === 'blockComment') {
            while (!stream.eol()) {
                if (stream.match('*/')) {
                    state.context = 'top';
                    return 'blockComment';
                }
                stream.next();
            }
            return 'blockComment';
        }

        // Single-quoted string continuation
        if (state.context === 'singleString') {
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') {
                    stream.next();
                } else if (ch === "'") {
                    if (stream.peek() === "'") {
                        stream.next();
                    } else {
                        state.context = 'top';
                        return 'string';
                    }
                }
            }
            return 'string';
        }

        // Quoted identifier continuation
        if (state.context === 'quotedIdentifier') {
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') {
                    stream.next();
                } else if (ch === '"') {
                    state.context = 'top';
                    return 'string.special';
                }
            }
            return 'string.special';
        }

        // Top-level tokenization
        if (stream.eatSpace()) return null;

        if (stream.match('--')) {
            stream.skipToEnd();
            return 'lineComment';
        }

        if (stream.match('/*')) {
            state.context = 'blockComment';
            while (!stream.eol()) {
                if (stream.match('*/')) {
                    state.context = 'top';
                    return 'blockComment';
                }
                stream.next();
            }
            return 'blockComment';
        }

        if (stream.peek() === "'") {
            stream.next();
            state.context = 'singleString';
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') {
                    stream.next();
                } else if (ch === "'") {
                    if (stream.peek() === "'") {
                        stream.next();
                    } else {
                        state.context = 'top';
                        return 'string';
                    }
                }
            }
            return 'string';
        }

        if (stream.peek() === '"') {
            stream.next();
            state.context = 'quotedIdentifier';
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') {
                    stream.next();
                } else if (ch === '"') {
                    state.context = 'top';
                    return 'string.special';
                }
            }
            return 'string.special';
        }

        if (
            stream.match(/^0[xX][0-9a-fA-F]+/) ||
            stream.match(/^\d+\.\d*(?:[eE][-+]?\d+)?/) ||
            stream.match(/^\d+[eE][-+]?\d+/) ||
            stream.match(/^\d+/)
        ) {
            return 'number';
        }

        if (stream.match(/^(?:>>>|>>|<<|\|\||[<>]=?|!=|<>|\?\?)/) || stream.match(/^[+\-*/%&|^~]/)) {
            return 'operator';
        }

        if (stream.match(/^[()[\]]/)) return 'paren';
        if (stream.match(/^[,;.]/)) return 'punctuation';

        if (stream.match(/^[a-zA-Z_]\w*/)) {
            const word = stream.current().toUpperCase();
            if (CM_OPERATORS.has(word)) return 'operatorKeyword';
            if (CM_KEYWORDS.has(word)) return 'keyword';
            if (CM_BUILTINS.has(word)) return 'function(definition)';
            return 'variableName';
        }

        stream.next();
        return null;
    },
};

