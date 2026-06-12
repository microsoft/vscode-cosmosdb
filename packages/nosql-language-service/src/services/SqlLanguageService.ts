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
import { detectBetweenAmbiguity } from '../diagnostics/betweenAmbiguity.js';
import { detectTypos } from '../diagnostics/typoDetection.js';
import { parse, type ParseResult } from '../index.js';
import { SqlLexer } from '../lexer/SqlLexer.js';
import * as T from '../lexer/tokens.js';
import { sqlToString } from '../printer/SqlPrinter.js';
import { getFunctionDoc, getKeywordDoc } from './docLoader.js';
import { getFunctionMeta } from './functionSignatures.js';
import { parseMultiQueryDocument, type MultiQueryDocument, type QueryRegion } from './MultiQueryDocument.js';
import {
    DiagnosticSeverity,
    type ActiveBlockRange,
    type Diagnostic,
    type FoldableRegion,
    type HoverInfo,
    type LanguageServiceHost,
    type SeparatorPosition,
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

    /** Whether the host enabled multi-query document support. */
    get multiQuery(): boolean {
        return !!this.host.multiQuery;
    }

    // ─── Multi-query document ──────────────────────────────

    /**
     * Parse a document that may contain multiple semicolon-separated
     * queries. Returns a {@link MultiQueryDocument} with all regions.
     *
     * Works regardless of the `multiQuery` host flag — callers can
     * use this directly when they need region-level access.
     */
    parseDocument(query: string): MultiQueryDocument {
        return parseMultiQueryDocument(query);
    }

    /**
     * Return the {@link QueryRegion} containing `offset`.
     * Convenience shortcut for `parseDocument(query).regionAtOffset(offset)`.
     */
    getActiveRegion(query: string, offset: number): QueryRegion | undefined {
        return parseMultiQueryDocument(query).regionAtOffset(offset);
    }

    /**
     * Strip line comments (`--`) and block comments (`/* … *\/`) from a
     * query string, returning only the executable SQL text.
     *
     * Delegates to the standalone {@link stripComments} function.
     */
    stripComments(text: string): string {
        return stripComments(text);
    }

    /**
     * Compute foldable regions for a multi-query document.
     *
     * Each non-empty query region is returned with content offsets
     * (leading/trailing whitespace stripped). The caller converts
     * offsets to line numbers and filters single-line regions.
     *
     * Returns an empty array when the document has only one region.
     */
    getFoldableRegions(query: string): FoldableRegion[] {
        const doc = parseMultiQueryDocument(query);
        if (doc.regions.length <= 1) return [];

        const result: FoldableRegion[] = [];
        for (const region of doc.regions) {
            if (region.text.trim().length === 0) continue;

            const leadingWs = region.text.length - region.text.trimStart().length;
            const contentStartOffset = region.startOffset + leadingWs;
            const contentEndOffset = region.startOffset + region.text.trimEnd().length;

            result.push({ contentStartOffset, contentEndOffset });
        }

        return result;
    }

    /**
     * Compute separator positions for a multi-query document.
     *
     * Returns the semicolon offset for every region except the last.
     * The caller maps each offset to a line to draw a separator.
     *
     * Returns an empty array when the document has only one region.
     */
    getSeparatorPositions(query: string): SeparatorPosition[] {
        const doc = parseMultiQueryDocument(query);
        if (doc.regions.length <= 1) return [];

        const result: SeparatorPosition[] = [];
        for (let i = 0; i < doc.regions.length - 1; i++) {
            result.push({ semicolonOffset: doc.regions[i].endOffset - 1 });
        }

        return result;
    }

    /**
     * Resolve the content range of the active query block for the given
     * cursor offset, with leading/trailing whitespace stripped.
     *
     * Editors use this to highlight the block under the cursor. The
     * whitespace trim matters because a region's `startOffset` sits
     * immediately after the previous `;` (on the previous query's line) —
     * without trimming, the highlight would bleed onto that line and mark
     * two queries as active.
     *
     * Returns `null` when:
     * - the document has one or zero non-empty regions (nothing to
     *   distinguish), or
     * - the cursor is not inside a non-empty region, or
     * - the active region is whitespace-only.
     */
    getActiveBlockOffsets(query: string, cursorOffset: number): ActiveBlockRange | null {
        const doc = parseMultiQueryDocument(query);

        // Only highlight when there is more than one non-empty region.
        const nonEmpty = doc.regions.filter((r) => r.text.trim().length > 0);
        if (nonEmpty.length <= 1) return null;

        const region = doc.regionAtOffset(cursorOffset);
        if (!region || region.text.trim().length === 0) return null;

        const regionText = region.text;
        let leading = 0;
        while (leading < regionText.length && /\s/.test(regionText[leading])) leading++;
        let trailing = regionText.length;
        while (trailing > leading && /\s/.test(regionText[trailing - 1])) trailing--;

        const startOffset = region.startOffset + leading;
        const endOffset = region.startOffset + trailing;
        if (endOffset <= startOffset) return null;

        return { startOffset, endOffset };
    }

    // ─── Diagnostics ────────────────────────────────────────

    /**
     * Parse `query` and return an array of diagnostics (errors).
     * Returns an empty array when the query is valid.
     *
     * When `multiQuery` is enabled, parses each region independently
     * and returns diagnostics with document-level offsets.
     */
    getDiagnostics(query: string): Diagnostic[] {
        if (this.host.multiQuery) {
            return this.getMultiQueryDiagnostics(query);
        }
        return this.getSingleQueryDiagnostics(query);
    }

    /**
     * Returns `true` when the host has a schema configured.
     *
     * Used to gate schema-dependent diagnostics: when no schema is available
     * we cannot know whether a field like `c.someField` is valid, so we
     * suppress any diagnostic whose code starts with `FIELD_` or equals
     * `UNKNOWN_FIELD`. Today no such codes are emitted — this is a forward-
     * looking guard so future field-validation work respects the contract.
     */
    private hasSchema(): boolean {
        return !!this.host.getSchema?.();
    }

    /** Filter out schema-dependent diagnostics when no schema is configured. */
    private filterSchemaDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
        if (this.hasSchema()) return diagnostics;
        return diagnostics.filter(
            (d) => d.code !== 'UNKNOWN_FIELD' && (typeof d.code !== 'string' || !d.code.startsWith('FIELD_')),
        );
    }

    private getSingleQueryDiagnostics(query: string): Diagnostic[] {
        const { errors } = parse(query);
        const diagnostics: Diagnostic[] = errors.map((e) => ({
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

        // Append typo warnings (near-miss keyword detection)
        for (const typo of detectTypos(query)) {
            diagnostics.push({
                range: {
                    startOffset: typo.range.start.offset,
                    endOffset: typo.range.end.offset,
                    startLine: typo.range.start.line,
                    startColumn: typo.range.start.col,
                    endLine: typo.range.end.line,
                    endColumn: typo.range.end.col,
                },
                message: typo.message,
                severity: DiagnosticSeverity.Warning,
                code: 'POSSIBLE_TYPO',
                source: 'cosmosdb-sql',
            });
        }

        // Append BETWEEN ambiguity warnings
        for (const w of detectBetweenAmbiguity(query)) {
            diagnostics.push({
                range: {
                    startOffset: w.range.start.offset,
                    endOffset: w.range.end.offset,
                    startLine: w.range.start.line,
                    startColumn: w.range.start.col,
                    endLine: w.range.end.line,
                    endColumn: w.range.end.col,
                },
                message: w.message,
                severity: DiagnosticSeverity.Warning,
                code: 'BETWEEN_AMBIGUITY',
                source: 'cosmosdb-sql',
            });
        }

        return this.filterSchemaDiagnostics(diagnostics);
    }

    private getMultiQueryDiagnostics(query: string): Diagnostic[] {
        const doc = parseMultiQueryDocument(query);
        const diagnostics: Diagnostic[] = [];

        for (const region of doc.regions) {
            if (!region.parseResult) continue;

            for (const e of region.parseResult.errors) {
                // Recompute line/column relative to the full document
                const docStartOffset = region.startOffset + e.range.start.offset;
                const docEndOffset = region.startOffset + e.range.end.offset;
                const { line: startLine, col: startColumn } = offsetToLineCol(query, docStartOffset);
                const { line: endLine, col: endColumn } = offsetToLineCol(query, docEndOffset);

                diagnostics.push({
                    range: {
                        startOffset: docStartOffset,
                        endOffset: docEndOffset,
                        startLine,
                        startColumn,
                        endLine,
                        endColumn,
                    },
                    message: e.message,
                    severity: DiagnosticSeverity.Error,
                    code: e.code,
                    source: 'cosmosdb-sql',
                });
            }

            // Typo warnings for this region
            const regionText = query.substring(region.startOffset, region.endOffset);
            for (const typo of detectTypos(regionText)) {
                const docStartOffset = region.startOffset + typo.range.start.offset;
                const docEndOffset = region.startOffset + typo.range.end.offset;
                const { line: startLine, col: startColumn } = offsetToLineCol(query, docStartOffset);
                const { line: endLine, col: endColumn } = offsetToLineCol(query, docEndOffset);

                diagnostics.push({
                    range: {
                        startOffset: docStartOffset,
                        endOffset: docEndOffset,
                        startLine,
                        startColumn,
                        endLine,
                        endColumn,
                    },
                    message: typo.message,
                    severity: DiagnosticSeverity.Warning,
                    code: 'POSSIBLE_TYPO',
                    source: 'cosmosdb-sql',
                });
            }

            // BETWEEN ambiguity warnings for this region
            for (const w of detectBetweenAmbiguity(regionText)) {
                const docStartOffset = region.startOffset + w.range.start.offset;
                const docEndOffset = region.startOffset + w.range.end.offset;
                const { line: startLine, col: startColumn } = offsetToLineCol(query, docStartOffset);
                const { line: endLine, col: endColumn } = offsetToLineCol(query, docEndOffset);

                diagnostics.push({
                    range: {
                        startOffset: docStartOffset,
                        endOffset: docEndOffset,
                        startLine,
                        startColumn,
                        endLine,
                        endColumn,
                    },
                    message: w.message,
                    severity: DiagnosticSeverity.Warning,
                    code: 'BETWEEN_AMBIGUITY',
                    source: 'cosmosdb-sql',
                });
            }
        }

        return this.filterSchemaDiagnostics(diagnostics);
    }

    // ─── Completions ────────────────────────────────────────

    /**
     * Return autocomplete suggestions for the given cursor offset.
     */
    getCompletions(query: string, offset: number): CompletionItem[] {
        const schema = this.host.getSchema?.();
        const aliases = this.host.getAliases?.();

        if (this.host.multiQuery) {
            const local = this.toLocalContext(query, offset);
            if (!local) return [];
            return getCompletions({ query: local.text, offset: local.localOffset, schema, aliases });
        }

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
        if (this.host.multiQuery) {
            const local = this.toLocalContext(query, offset);
            if (!local) return null;
            const result = this.getHoverInfoSingle(local.text, local.localOffset);
            if (result?.range) {
                result.range = shiftRange(result.range, local.region.startOffset, query);
            }
            return result;
        }
        return this.getHoverInfoSingle(query, offset);
    }

    private getHoverInfoSingle(query: string, offset: number): HoverInfo | null {
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
        if (this.host.multiQuery) {
            const local = this.toLocalContext(query, offset);
            if (!local) return null;
            return this.getSignatureHelpSingle(local.text, local.localOffset);
        }
        return this.getSignatureHelpSingle(query, offset);
    }

    private getSignatureHelpSingle(query: string, offset: number): SignatureHelpResult | null {
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
     *
     * When `multiQuery` is enabled, formats each region
     * independently and joins them with `;\n\n`.
     */
    format(query: string): string {
        if (this.host.multiQuery) {
            const doc = parseMultiQueryDocument(query);
            const formatted = doc.regions.map((region) => {
                if (!region.parseResult || region.parseResult.errors.length > 0 || !region.parseResult.ast) {
                    return region.text;
                }
                return sqlToString(region.parseResult.ast);
            });
            return formatted.join(';\n\n');
        }
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

    /**
     * Map a document-level offset to a local region context.
     * Used by multi-query routing in completions, hover, and signature help.
     */
    private toLocalContext(
        query: string,
        offset: number,
    ): { region: QueryRegion; text: string; localOffset: number } | undefined {
        const doc = parseMultiQueryDocument(query);
        const result = doc.toLocalOffset(offset);
        if (!result) return undefined;
        return {
            region: result.region,
            text: result.region.text,
            localOffset: result.localOffset,
        };
    }

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

/**
 * Convert a 0-based byte offset into 1-based line and column numbers.
 */
function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
    let line = 1;
    let col = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    return { line, col };
}

/**
 * Shift a local-region {@link TextRange} to document-level coordinates.
 */
function shiftRange(range: TextRange, regionStartOffset: number, fullText: string): TextRange {
    const docStartOffset = regionStartOffset + range.startOffset;
    const docEndOffset = regionStartOffset + range.endOffset;
    const start = offsetToLineCol(fullText, docStartOffset);
    const end = offsetToLineCol(fullText, docEndOffset);
    return {
        startOffset: docStartOffset,
        endOffset: docEndOffset,
        startLine: start.line,
        startColumn: start.col,
        endLine: end.line,
        endColumn: end.col,
    };
}

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

// ---------------------------------------------------------------------------
// Standalone utilities
// ---------------------------------------------------------------------------

/**
 * Strip line comments (`--`) and block comments (`/* … *\/`) from a query
 * string, returning only the executable SQL text.
 *
 * Uses the lexer to locate token boundaries — comments are already classified
 * as `SKIPPED` tokens, so they never appear in the token list. The gaps
 * between real tokens (which contain whitespace and/or comments) are replaced
 * with a single space or newline, preserving readability without any comment
 * text leaking through.
 *
 * This is a pure, stateless function — no service instance required. It is
 * safe to call from any context (extension host, webview, tests).
 *
 * @param text - Raw query text, possibly containing comments.
 * @returns The query with all comments removed and leading/trailing whitespace
 *   trimmed. Returns an empty string when the input is blank or comment-only.
 *
 * @example
 * ```typescript
 * stripComments('-- get all\nSELECT * FROM c');
 * // => 'SELECT * FROM c'
 *
 * stripComments('SELECT /* fields *\/ * FROM c');
 * // => 'SELECT * FROM c'
 * ```
 */
export function stripComments(text: string): string {
    const lexResult = SqlLexer.tokenize(text);
    const tokens = lexResult.tokens;
    if (tokens.length === 0) return '';

    const parts: string[] = [];
    let pos = 0;

    for (const token of tokens) {
        const gapStart = pos;
        const gapEnd = token.startOffset;

        if (gapStart < gapEnd) {
            // The gap between non-skipped tokens contains only whitespace
            // and/or comments. Replace with a single space, or a newline
            // when the original gap spanned multiple lines (preserves
            // readability for multi-line queries).
            const gap = text.substring(gapStart, gapEnd);
            parts.push(gap.includes('\n') ? '\n' : ' ');
        }

        parts.push(token.image);
        pos = (token.endOffset ?? token.startOffset + token.image.length - 1) + 1;
    }

    return parts.join('').trim();
}
