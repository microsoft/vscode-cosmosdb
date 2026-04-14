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

import { type SqlProgram } from './ast/nodes.js';
import { SqlErrorCode, type SourcePosition, type SqlParseError } from './errors/SqlError.js';
import { SqlLexer } from './lexer/SqlLexer.js';
import { SqlParser } from './parser/SqlParser.js';

// Re-export everything consumers need
export * from './ast/nodes.js';
export { getCompletions } from './completion/SqlCompletion.js';
export type { CompletionItem, CompletionItemKind, CompletionRequest, JSONSchema } from './completion/SqlCompletion.js';
export * from './errors/SqlError.js';
export { sqlToString } from './printer/SqlPrinter.js';
export * from './visitor/SqlVisitor.js';

// Language service (IDE-agnostic facade)
export { FUNCTION_SIGNATURES, getFunctionMeta } from './services/functionSignatures.js';
export type { FunctionMeta } from './services/functionSignatures.js';
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
        const startPos: SourcePosition = {
            offset: token.startOffset,
            line: token.startLine ?? 1,
            col: token.startColumn ?? 1,
        };
        const endPos: SourcePosition = {
            offset: (token.endOffset ?? token.startOffset) + 1,
            line: token.endLine ?? token.startLine ?? 1,
            col: (token.endColumn ?? token.startColumn ?? 0) + 1,
        };

        let code = SqlErrorCode.UnexpectedToken;
        if (token.startOffset >= query.length) {
            code = SqlErrorCode.UnexpectedEof;
        } else if (e.message.includes('expecting')) {
            code = SqlErrorCode.MissingKeyword;
        }

        errors.push({
            code,
            message: e.message,
            range: { start: startPos, end: endPos },
        });
    }

    return {
        ast: parserInstance.errors.length === 0 && lexResult.errors.length === 0 ? ast : ast, // Return AST even on error (partial via recovery)
        errors,
    };
}
