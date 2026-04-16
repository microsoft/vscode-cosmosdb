/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lightweight tokenizer for CosmosDB NoSQL queries.
 *
 * Breaks raw query text into a flat list of {@link Token} objects.
 * The tokenizer is environment-agnostic — no `vscode` or `monaco-editor` imports.
 *
 * Design notes:
 * - Single-pass, character-by-character scan.
 * - Multi-word keywords (ORDER BY, GROUP BY, ORDER BY RANK) are merged in a
 *   post-processing step so the caller always sees a single token.
 * - Comments and string tokens are preserved (not stripped) so the parser can
 *   skip them while still knowing their positions.
 */

import { NOSQL_FUNCTIONS, NOSQL_KEYWORD_TOKENS } from '../nosqlLanguageDefinitions';
import { type Token, type TokenType } from './types';

// ─── Lookup sets (built once at module load) ────────────────────────────────────

const KEYWORD_SET: ReadonlySet<string> = new Set(NOSQL_KEYWORD_TOKENS.map((k) => k.toUpperCase()));

const FUNCTION_SET: ReadonlySet<string> = new Set(NOSQL_FUNCTIONS.map((f) => f.name.toUpperCase()));

/**
 * Characters that start an operator token.
 *
 * CosmosDB NoSQL has:
 * - Comparison: `=`, `!=`, `<>`, `<`, `>`, `<=`, `>=`
 * - Arithmetic: `+`, `-`, `/`, `%`
 * - Ternary: `?` (used in `?? `)
 *
 * Logical operators (AND, OR, NOT) are word-based and handled as keywords.
 * There are no bitwise (`|`, `&`, `~`, `^`) or logical (`||`, `&&`) operators.
 */
const OPERATOR_CHARS = new Set(['=', '!', '<', '>', '+', '-', '/', '%', '?']);

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Tokenizes a NoSQL query string into a flat token array.
 *
 * @param text - Full or partial NoSQL query text.
 * @returns An array of tokens in source order.
 */
export function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        // ── Whitespace (skip) ───────────────────────────────────────────
        if (isWhitespace(ch)) {
            i++;
            continue;
        }

        // ── Line comment: -- ────────────────────────────────────────────
        if (ch === '-' && text[i + 1] === '-') {
            const start = i;
            i += 2;
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            tokens.push({ type: 'comment', value: text.substring(start, i), start, end: i });
            continue;
        }

        // ── Block comment: /* ... */ ────────────────────────────────────
        if (ch === '/' && text[i + 1] === '*') {
            const start = i;
            i += 2;
            while (i < text.length) {
                if (text[i] === '*' && text[i + 1] === '/') {
                    i += 2;
                    break;
                }
                i++;
            }
            tokens.push({ type: 'comment', value: text.substring(start, i), start, end: i });
            continue;
        }

        // ── Single-quoted string ────────────────────────────────────────
        if (ch === "'") {
            const start = i;
            i++;
            while (i < text.length) {
                if (text[i] === "'" && text[i + 1] === "'") {
                    i += 2; // SQL-style escaped quote
                } else if (text[i] === '\\') {
                    i += 2; // backslash escape
                } else if (text[i] === "'") {
                    i++;
                    break;
                } else {
                    i++;
                }
            }
            tokens.push({ type: 'string', value: text.substring(start, i), start, end: i });
            continue;
        }

        // ── Double-quoted string ────────────────────────────────────────
        if (ch === '"') {
            const start = i;
            i++;
            while (i < text.length) {
                if (text[i] === '\\') {
                    i += 2;
                } else if (text[i] === '"') {
                    i++;
                    break;
                } else {
                    i++;
                }
            }
            tokens.push({ type: 'string', value: text.substring(start, i), start, end: i });
            continue;
        }

        // ── Number literal ──────────────────────────────────────────────
        if (isDigit(ch) || (ch === '.' && i + 1 < text.length && isDigit(text[i + 1]))) {
            const start = i;
            if (ch === '0' && (text[i + 1] === 'x' || text[i + 1] === 'X')) {
                // Hex literal
                i += 2;
                while (i < text.length && isHexDigit(text[i])) i++;
            } else {
                while (i < text.length && isDigit(text[i])) i++;
                if (i < text.length && text[i] === '.') {
                    i++;
                    while (i < text.length && isDigit(text[i])) i++;
                }
                // Scientific notation
                if (i < text.length && (text[i] === 'e' || text[i] === 'E')) {
                    i++;
                    if (i < text.length && (text[i] === '+' || text[i] === '-')) i++;
                    while (i < text.length && isDigit(text[i])) i++;
                }
            }
            tokens.push({ type: 'number', value: text.substring(start, i), start, end: i });
            continue;
        }

        // ── Identifier / keyword / function ─────────────────────────────
        if (isIdentStart(ch)) {
            const start = i;
            while (i < text.length && isIdentPart(text[i])) i++;
            const value = text.substring(start, i);
            const upper = value.toUpperCase();

            let type: TokenType = 'identifier';
            if (KEYWORD_SET.has(upper)) {
                type = 'keyword';
            } else if (FUNCTION_SET.has(upper)) {
                type = 'function';
            }

            tokens.push({ type, value, start, end: i });
            continue;
        }

        // ── Multi-character operators (!=, <>, >=, <=, ??) ─────────────
        if (OPERATOR_CHARS.has(ch)) {
            const start = i;
            i++;
            // Consume second char for two-char operators
            if (i < text.length) {
                const pair = ch + text[i];
                if (pair === '!=' || pair === '>=' || pair === '<=' || pair === '<>' || pair === '??') {
                    i++;
                }
            }
            tokens.push({ type: 'operator', value: text.substring(start, i), start, end: i });
            continue;
        }

        // ── Punctuation (single char: ; , . ( ) [ ] * ) ────────────────
        const start = i;
        i++;
        tokens.push({ type: 'punctuation', value: text.substring(start, i), start, end: i });
    }

    // ── Post-process: merge multi-word keywords ─────────────────────────
    return mergeMultiWordKeywords(tokens);
}

// ─── Multi-word keyword merging ─────────────────────────────────────────────────

/**
 * Multi-word keyword patterns to merge.
 * ORDER BY RANK must come before ORDER BY so longest match wins.
 */
const MULTI_WORD_KEYWORDS: readonly string[][] = [
    ['ORDER', 'BY', 'RANK'],
    ['ORDER', 'BY'],
    ['GROUP', 'BY'],
];

/**
 * Merges adjacent keyword tokens that form multi-word keywords
 * (e.g. ORDER + BY → ORDER BY). Skips comment tokens between parts.
 */
function mergeMultiWordKeywords(tokens: Token[]): Token[] {
    const result: Token[] = [];
    let i = 0;

    while (i < tokens.length) {
        let merged = false;
        for (const pattern of MULTI_WORD_KEYWORDS) {
            const matchTokens = tryMatchMultiWord(tokens, i, pattern);
            if (matchTokens) {
                const first = matchTokens[0];
                const last = matchTokens[matchTokens.length - 1];
                result.push({
                    type: 'keyword',
                    value: pattern.join(' '),
                    start: first.start,
                    end: last.end,
                });
                // Advance past all consumed tokens (including skipped comments)
                i = tokens.indexOf(last) + 1;
                merged = true;
                break;
            }
        }
        if (!merged) {
            result.push(tokens[i]);
            i++;
        }
    }

    return result;
}

/**
 * Attempts to match a multi-word keyword pattern starting at index `start`.
 * Skips comment tokens between keyword parts.
 * Returns the matched keyword tokens (not comments) or `null` on failure.
 */
function tryMatchMultiWord(tokens: Token[], start: number, pattern: readonly string[]): Token[] | null {
    const matched: Token[] = [];
    let ti = start;
    for (const word of pattern) {
        // Skip comments
        while (ti < tokens.length && tokens[ti].type === 'comment') {
            ti++;
        }
        if (ti >= tokens.length) return null;
        const tok = tokens[ti];
        if (tok.type !== 'keyword' || tok.value.toUpperCase() !== word) return null;
        matched.push(tok);
        ti++;
    }
    return matched;
}

// ─── Character classification helpers ───────────────────────────────────────────

function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string): boolean {
    return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isIdentPart(ch: string): boolean {
    return isIdentStart(ch) || isDigit(ch);
}
