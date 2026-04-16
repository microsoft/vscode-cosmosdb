/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module index
 *
 * Public API entry point for `@cosmosdb/nosql-language-service`.
 *
 * @example
 * ```typescript
 * import { parse, sqlToString, getCompletions } from "@cosmosdb/nosql-language-service";
 *
 * // Parse a query
 * const { ast, errors } = parse("SELECT * FROM c WHERE c.age > 21");
 *
 * // Round-trip: AST → SQL string
 * const sql = sqlToString(ast!);
 *
 * // Get autocomplete suggestions
 * const items = getCompletions({ query: "SELECT c.", offset: 9, schema });
 * ```
 */

// ---------------------------------------------------------------------------
// @cosmosdb/nosql-language-service — public API
// ---------------------------------------------------------------------------

import { MismatchedTokenException, NotAllInputParsedException } from 'chevrotain';
import { type SqlProgram } from './ast/nodes.js';
import { SqlErrorCode, type SourcePosition, type SqlParseError } from './errors/SqlError.js';
import { SqlLexer } from './lexer/SqlLexer.js';
import { SqlParser } from './parser/SqlParser.js';

// Re-export everything consumers need
export * from './ast/nodes.js';
export { getCompletions } from './completion/SqlCompletion.js';
export type { CompletionItem, CompletionItemKind, CompletionRequest, JSONSchema } from './completion/SqlCompletion.js';
export { detectTypos } from './diagnostics/typoDetection.js';
export type { TypoWarning } from './diagnostics/typoDetection.js';
export * from './errors/SqlError.js';
export { sqlToString } from './printer/SqlPrinter.js';
export * from './visitor/SqlVisitor.js';

// Language service (IDE-agnostic facade)
export { FUNCTION_SIGNATURES, getFunctionMeta } from './services/functionSignatures.js';
export type { FunctionMeta } from './services/functionSignatures.js';
export { parseMultiQueryDocument } from './services/MultiQueryDocument.js';
export type { MultiQueryDocument, QueryRegion } from './services/MultiQueryDocument.js';
export { SqlLanguageService } from './services/SqlLanguageService.js';
export type {
    Diagnostic,
    DiagnosticSeverity,
    Disposable,
    HoverInfo,
    LanguageServiceHost,
    ParameterInfo,
    SignatureHelpResult,
    SignatureInfo,
    TextEdit,
    TextRange,
} from './services/types.js';

// ---------------------------------------------------------------------------
// Parse result
// ---------------------------------------------------------------------------

/**
 * The result of parsing a CosmosDB NoSQL SQL query.
 * Always contains an `errors` array; `ast` is present even when
 * errors occur (partial AST via Chevrotain error recovery).
 */
export interface ParseResult {
    /** The AST, present even on error (partial AST via error recovery) */
    ast?: SqlProgram;
    /** List of parse errors (empty if query is valid) */
    errors: SqlParseError[];
}

/**
 * Singleton parser instance — Chevrotain parsers are stateful but
 * designed to be reused by resetting `.input` between calls.
 * @internal
 */
const parserInstance = new SqlParser();

/**
 * Convert a 0-based byte offset to a 1-based line/col {@link SourcePosition}.
 * Used as a fallback when Chevrotain doesn't provide line/col (e.g. EOF token).
 */
function offsetToPosition(text: string, offset: number): SourcePosition {
    let line = 1;
    let col = 1;
    const end = Math.min(offset, text.length);
    for (let i = 0; i < end; i++) {
        if (text[i] === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    return { offset, line, col };
}

/**
 * Parse a CosmosDB NoSQL SQL query string into a typed AST.
 *
 * The parser uses Chevrotain's built-in error recovery, so it will
 * attempt to build a partial AST even when the query is invalid.
 * Check `result.errors` to determine validity.
 *
 * @param query - The SQL query string to parse.
 * @returns A {@link ParseResult} with the AST and any errors.
 *
 * @example
 * ```typescript
 * const { ast, errors } = parse("SELECT * FROM c");
 * if (errors.length === 0) {
 *   console.log(ast!.query.select.spec.kind); // "SelectStarSpec"
 * }
 * ```
 */
// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parse(query: string): ParseResult {
    // 1. Lex
    const lexResult = SqlLexer.tokenize(query);

    // Collect lexer errors
    const errors: SqlParseError[] = lexResult.errors.map((e) => ({
        code: SqlErrorCode.UnexpectedToken,
        message: e.message,
        range: {
            start: { offset: e.offset, line: e.line ?? 1, col: e.column ?? 1 },
            end: { offset: e.offset + (e.length ?? 1), line: e.line ?? 1, col: (e.column ?? 1) + (e.length ?? 1) },
        },
    }));

    // 2. Parse
    parserInstance.input = lexResult.tokens;
    const ast = parserInstance.program();

    // Collect parser errors
    for (const e of parserInstance.errors) {
        const token = e.token;

        // Chevrotain returns NaN for virtual EOF tokens — treat NaN as missing
        const safeOffset = (v: number | undefined, fallback: number) =>
            v !== undefined && !isNaN(v) ? v : fallback;

        const startOffset = safeOffset(token.startOffset, query.length);
        const endOffset = safeOffset(token.endOffset, startOffset) + 1;
        const startLine = safeOffset(token.startLine, undefined as unknown as number);
        const startCol = safeOffset(token.startColumn, undefined as unknown as number);

        // If Chevrotain didn't provide line/col (EOF token), compute from offset
        const computedStart =
            startLine !== undefined
                ? { offset: startOffset, line: startLine, col: startCol ?? 1 }
                : offsetToPosition(query, startOffset);

        const endLine = safeOffset(token.endLine, undefined as unknown as number);
        const endCol = safeOffset(token.endColumn, undefined as unknown as number);
        const computedEnd =
            endLine !== undefined
                ? { offset: endOffset, line: endLine, col: (endCol ?? 0) + 1 }
                : offsetToPosition(query, endOffset);

        let code = SqlErrorCode.UnexpectedToken;
        if (startOffset >= query.length) {
            code = SqlErrorCode.UnexpectedEof;
        } else if (
            e instanceof MismatchedTokenException ||
            e instanceof NotAllInputParsedException
        ) {
            code = SqlErrorCode.MissingKeyword;
        } else if (e.message.includes('Expected') || e.message.includes('expecting')) {
            code = SqlErrorCode.MissingKeyword;
        }

        errors.push({
            code,
            message: e.message,
            range: { start: computedStart, end: computedEnd },
        });
    }

    return {
        ast: parserInstance.errors.length === 0 && lexResult.errors.length === 0 ? ast : ast, // Return AST even on error (partial via recovery)
        errors,
    };
}
