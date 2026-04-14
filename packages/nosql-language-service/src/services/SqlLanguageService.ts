/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// SqlLanguageService — IDE-agnostic facade over the parser, completion
// engine, hover, diagnostics, and formatting.
//
// Consumers can use this class directly (headless / custom UI) or pass
// it to a ready-made provider adapter (Monaco, VS Code, CodeMirror…).
// ---------------------------------------------------------------------------

import { type IToken, type TokenType } from 'chevrotain';
import { getCompletions, type CompletionItem, type JSONSchema } from '../completion/SqlCompletion.js';
import { parse, type ParseResult } from '../index.js';
import { SqlLexer } from '../lexer/SqlLexer.js';
import * as T from '../lexer/tokens.js';
import { sqlToString } from '../printer/SqlPrinter.js';
import { getFunctionDoc, getKeywordDoc } from './docLoader.js';
import { getFunctionMeta } from './functionSignatures.js';
import {
    DiagnosticSeverity,
    type Diagnostic,
    type HoverInfo,
    type LanguageServiceHost,
    type SignatureHelpResult,
    type TextEdit,
    type TextRange,
} from './types.js';

// ========================== Language service ==================================

/**
 * High-level, IDE-agnostic language service for CosmosDB NoSQL SQL.
 *
 * Aggregates parsing, completion, diagnostics, hover, signature help,
 * and formatting behind a single stateless API. Each method takes a
 * query string (and an optional cursor offset) and returns generic
 * result types that any editor adapter can convert to its native
 * format.
 *
 * @example
 * ```typescript
 * import { SqlLanguageService } from "@cosmosdb/nosql-language-service";
 *
 * const service = new SqlLanguageService({
 *   getSchema: () => myCollectionSchema,
 * });
 *
 * const diagnostics = service.getDiagnostics("SELECT * FORM c");
 * const completions = service.getCompletions("SELECT c.", 9);
 * const hover       = service.getHoverInfo("SELECT COUNT(c.id) FROM c", 7);
 * ```
 */
export class SqlLanguageService {
    private readonly host: LanguageServiceHost;

    constructor(host?: LanguageServiceHost) {
        this.host = host ?? {};
    }

    // ─── Diagnostics ────────────────────────────────────────

    /**
     * Parse `query` and return an array of diagnostics (errors).
     * Returns an empty array when the query is valid.
     */
    getDiagnostics(query: string): Diagnostic[] {
        const { errors } = parse(query);
        return errors.map((e) => ({
            range: {
                startOffset: e.range.start.offset,
                endOffset: e.range.end.offset,
                startLine: e.range.start.line,
                startColumn: e.range.start.col,
                endLine: e.range.end.line,
                endColumn: e.range.end.col,
            },
            message: e.message,
            severity: DiagnosticSeverity.Error,
            code: e.code,
            source: 'cosmosdb-sql',
        }));
    }

    // ─── Completions ────────────────────────────────────────

    /**
     * Return autocomplete suggestions for the given cursor offset.
     */
    getCompletions(query: string, offset: number): CompletionItem[] {
        const schema = this.host.getSchema?.();
        const aliases = this.host.getAliases?.();
        return getCompletions({ query, offset, schema, aliases });
    }

    // ─── Hover ──────────────────────────────────────────────

    /**
     * Return hover information for the token at `offset`.
     *
     * Recognizes:
     * - **Built-in functions** — shows signature and description.
     * - **Keywords** — shows a short explanation.
     * - **Schema fields** (when schema is available) — shows type.
     */
    getHoverInfo(query: string, offset: number): HoverInfo | null {
        const lexResult = SqlLexer.tokenize(query);
        const token = findTokenAt(lexResult.tokens, offset);
        if (!token) return null;

        const range = tokenToRange(token);
        const image = token.image;

        // 1. Built-in function — try .md doc file first, then inline meta
        const funcDoc = getFunctionDoc(image);
        if (funcDoc) {
            return { contents: [funcDoc], range };
        }
        const meta = getFunctionMeta(image);
        if (meta) {
            const sigLabels = meta.signatures.map((s) => `\`${s.label}\``).join('\n\n');
            return {
                contents: [`**${image}** — ${meta.category} function`, meta.description, sigLabels],
                range,
            };
        }

        // 2. SQL keyword — try .md doc file first, then inline map
        const kwDoc = getKeywordDoc(token.image.toUpperCase());
        if (kwDoc) {
            return { contents: [kwDoc], range };
        }
        const keywordInfo = getKeywordHover(token);
        if (keywordInfo) {
            return { contents: [keywordInfo], range };
        }

        // 3. Schema field (after a dot on a known alias)
        const schema = this.host.getSchema?.();
        if (schema) {
            const fieldHover = this.getFieldHover(query, token, schema);
            if (fieldHover) {
                return { contents: fieldHover, range };
            }
        }

        return null;
    }

    // ─── Signature help ─────────────────────────────────────

    /**
     * Return signature help when the cursor is inside a function
     * call's parentheses. Returns `null` when not in a function call.
     */
    getSignatureHelp(query: string, offset: number): SignatureHelpResult | null {
        const lexResult = SqlLexer.tokenize(query);
        const tokens = lexResult.tokens;

        // Walk backwards from cursor to find the enclosing "funcName("
        let parenDepth = 0;
        let commaCount = 0;
        let funcToken: IToken | null = null;

        for (let i = tokens.length - 1; i >= 0; i--) {
            const t = tokens[i];
            if (t.startOffset >= offset) continue;

            if (t.tokenType === T.RParen) {
                parenDepth++;
                continue;
            }
            if (t.tokenType === T.LParen) {
                if (parenDepth > 0) {
                    parenDepth--;
                    continue;
                }
                // Found the matching open paren — previous token is the function name
                if (i > 0 && isIdentifierLike(tokens[i - 1].tokenType)) {
                    funcToken = tokens[i - 1];
                }
                break;
            }
            if (t.tokenType === T.Comma && parenDepth === 0) {
                commaCount++;
            }
        }

        if (!funcToken) return null;

        const meta = getFunctionMeta(funcToken.image);
        if (!meta) return null;

        return {
            signatures: meta.signatures,
            activeSignature: 0,
            activeParameter: commaCount,
        };
    }

    // ─── Formatting ─────────────────────────────────────────

    /**
     * Format a query string by parsing and re-printing it.
     * Returns the original string unchanged if parsing fails
     * with errors.
     */
    format(query: string): string {
        const { ast, errors } = parse(query);
        if (errors.length > 0 || !ast) return query;
        return sqlToString(ast);
    }

    /**
     * Return a set of text edits that transform `query` into its
     * formatted form. Useful for editors that apply incremental edits.
     */
    getFormatEdits(query: string): TextEdit[] {
        const formatted = this.format(query);
        if (formatted === query) return [];
        // For simplicity, return a single whole-document replacement.
        // A smarter diff could minimize edits.
        const lines = query.split('\n');
        const lastLine = lines[lines.length - 1];
        return [
            {
                range: {
                    startOffset: 0,
                    endOffset: query.length,
                    startLine: 1,
                    startColumn: 1,
                    endLine: lines.length,
                    endColumn: lastLine.length + 1,
                },
                newText: formatted,
            },
        ];
    }

    // ─── Parsing (pass-through) ─────────────────────────────

    /**
     * Parse a query and return the full result (AST + errors).
     * Convenience method — same as importing `parse` directly.
     */
    parse(query: string): ParseResult {
        return parse(query);
    }

    // ─── Private helpers ────────────────────────────────────

    private getFieldHover(query: string, token: IToken, schema: JSONSchema): string[] | null {
        if (!isIdentifierLike(token.tokenType)) return null;

        // Look backwards for a dot chain: "c.address.city"
        const before = query.substring(0, token.startOffset);
        const dotChain = before.match(/([a-zA-Z_][a-zA-Z0-9_.]*)\.\s*$/);
        if (!dotChain) return null;

        const parts = dotChain[1].split('.');
        // Navigate schema
        let current: JSONSchema = schema;
        for (const part of parts) {
            const prop = current.properties?.[part];
            if (!prop) return null;
            current = prop as JSONSchema;
            if (current.type === 'array' && current.items && !Array.isArray(current.items)) {
                current = current.items as JSONSchema;
            }
        }

        const field = current.properties?.[token.image];
        if (!field) return null;
        const ps = field as JSONSchema;
        const type = Array.isArray(ps.type) ? ps.type.join(' | ') : (ps.type ?? 'unknown');
        const occurrence = ps['x-occurrence'];

        const lines = [`**${token.image}**: \`${type}\``];
        if (occurrence !== undefined) {
            lines.push(`Occurrence: ${occurrence}%`);
        }
        return lines;
    }
}

// ========================== Utilities ========================================

function findTokenAt(tokens: IToken[], offset: number): IToken | null {
    for (const t of tokens) {
        if (t.startOffset <= offset && (t.endOffset ?? t.startOffset) >= offset) {
            return t;
        }
    }
    return null;
}

function tokenToRange(token: IToken): TextRange {
    return {
        startOffset: token.startOffset,
        endOffset: (token.endOffset ?? token.startOffset) + 1,
        startLine: token.startLine ?? 1,
        startColumn: token.startColumn ?? 1,
        endLine: token.endLine ?? token.startLine ?? 1,
        endColumn: (token.endColumn ?? token.startColumn ?? 0) + 2,
    };
}

function isIdentifierLike(type: TokenType): boolean {
    return type === T.Identifier || type === T.Let || type === T.Rank || type === T.Left || type === T.Right;
}

function getKeywordHover(token: IToken): string | null {
    const kw: Record<string, string> = {
        SELECT: '**SELECT** — specifies the fields or expressions to return.',
        FROM: '**FROM** — specifies the source collection.',
        WHERE: '**WHERE** — filters documents by a condition.',
        JOIN: '**JOIN** — joins with a nested array or subquery.',
        'ORDER BY': '**ORDER BY** — sorts the result set.',
        'GROUP BY': '**GROUP BY** — groups results by one or more expressions.',
        TOP: '**TOP** — limits the result to the first N documents.',
        DISTINCT: '**DISTINCT** — removes duplicate values from the result.',
        VALUE: '**VALUE** — returns a scalar value instead of a JSON object.',
        OFFSET: '**OFFSET** — skips a number of results (pagination).',
        LIMIT: '**LIMIT** — limits the number of results (pagination).',
        AND: '**AND** — logical conjunction.',
        OR: '**OR** — logical disjunction.',
        NOT: '**NOT** — logical negation.',
        BETWEEN: '**BETWEEN** — tests if a value is within an inclusive range.',
        LIKE: '**LIKE** — pattern matching with wildcards (% and _).',
        IN: '**IN** — tests if a value is in a list.',
        EXISTS: '**EXISTS** — tests if a subquery returns any results.',
        ASC: '**ASC** — ascending sort order.',
        DESC: '**DESC** — descending sort order.',
        IS: '**IS** — used with NULL/UNDEFINED type checking.',
        NULL: '**null** — the JSON null value.',
        UNDEFINED: '**undefined** — the CosmosDB undefined value.',
        TRUE: '**true** — Boolean true.',
        FALSE: '**false** — Boolean false.',
        ARRAY: '**ARRAY** — creates an array from a subquery.',
    };
    return kw[token.image.toUpperCase()] ?? null;
}
