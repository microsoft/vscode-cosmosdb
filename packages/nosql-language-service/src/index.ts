/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module index
 *
 * Public API entry point for `@azure/cosmosdb-nosql-language-service`.
 *
 * @example
 * ```typescript
 * import { parse, sqlToString, getCompletions, type JSONSchema } from "@azure/cosmosdb-nosql-language-service";
 *
 * const schema: JSONSchema = {
 *   type: "object",
 *   properties: { age: { type: "number" } },
 * };
 *
 * // Parse a query
 * const { ast, errors } = parse("SELECT * FROM c WHERE c.age > 21");
 *
 * // Round-trip: AST → query text
 * if (ast && errors.length === 0) {
 *   console.log(sqlToString(ast));
 * }
 *
 * // Get autocomplete suggestions
 * const items = getCompletions({ query: "SELECT c.", offset: 9, schema });
 * ```
 */

// ---------------------------------------------------------------------------
// @azure/cosmosdb-nosql-language-service — public API
// ---------------------------------------------------------------------------

import { MismatchedTokenException, NotAllInputParsedException } from 'chevrotain';
import { type SqlProgram } from './ast/nodes.js';
import { createPositionResolver, tokenToSourceRange } from './errors/sourcePositions.js';
import { SqlErrorCode, type SqlParseError } from './errors/SqlError.js';
import { SqlLexer } from './lexer/SqlLexer.js';
import { exceedsAstDepth, MAX_AST_DEPTH, QueryTooComplexError } from './parser/queryComplexity.js';
import { SqlParser } from './parser/SqlParser.js';

// Re-export everything consumers need
export * from './ast/nodes.js';
export { getCompletions } from './completion/SqlCompletion.js';
export type { CompletionItem, CompletionItemKind, CompletionRequest, JSONSchema } from './completion/SqlCompletion.js';
export { detectTypos } from './diagnostics/typoDetection.js';
export type { TypoWarning } from './diagnostics/typoDetection.js';
export { detectOrderByInSubquery, ORDER_BY_IN_SUBQUERY_MESSAGE } from './diagnostics/orderByInSubquery.js';
export type { OrderByInSubqueryError } from './diagnostics/orderByInSubquery.js';
export * from './errors/SqlError.js';
export { sqlToString } from './printer/SqlPrinter.js';
export * from './visitor/SqlVisitor.js';

// Language service (IDE-agnostic facade)
export { FUNCTION_SIGNATURES, getFunctionMeta } from './services/functionSignatures.js';
export type { FunctionMeta } from './services/functionSignatures.js';
export { parseMultiQueryDocument } from './services/MultiQueryDocument.js';
export type { MultiQueryDocument, QueryRegion } from './services/MultiQueryDocument.js';
export { SqlLanguageService, stripComments } from './services/SqlLanguageService.js';
export { DiagnosticSeverity } from './services/types.js';
export type {
    Diagnostic,
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
 * The result of parsing a query written in the Cosmos DB query language.
 * Always contains an `errors` array. Recovery may produce a partial AST for
 * invalid input; an AST is not guaranteed and is omitted for complexity errors.
 */
export interface ParseResult {
    /** Complete or recovered partial AST, if available and within complexity limits */
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
 * Parse a query written in the Cosmos DB query language into a typed AST.
 *
 * The parser uses Chevrotain's built-in error recovery, so it will
 * attempt to build a partial AST even when the query is invalid.
 * Check `result.errors` to determine validity and `result.ast` before using it.
 * Excessive parser rule nesting or AST depth yields QUERY_TOO_COMPLEX without an AST.
 * Unexpected implementation errors are not suppressed.
 *
 * @param query - The query text to parse.
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
    const positionAt = createPositionResolver(query);

    // Collect lexer errors
    const errors: SqlParseError[] = lexResult.errors.map((e) => ({
        code: SqlErrorCode.UnexpectedToken,
        message: e.message,
        range: {
            start: positionAt(e.offset),
            end: positionAt(e.offset + (e.length ?? 1)),
        },
    }));

    // 2. Parse
    parserInstance.input = lexResult.tokens;
    let ast: SqlProgram | undefined;
    try {
        ast = parserInstance.program();
    } catch (error) {
        if (!(error instanceof QueryTooComplexError)) throw error;
        errors.push({
            code: SqlErrorCode.QueryTooComplex,
            message: error.message,
            range: tokenToSourceRange(query, error.token, positionAt),
        });
        return { errors };
    }

    // Collect parser errors
    for (const e of parserInstance.errors) {
        const range = tokenToSourceRange(query, e.token, positionAt);
        const startOffset = range.start.offset;

        let code = SqlErrorCode.UnexpectedToken;
        if (startOffset >= query.length) {
            code = SqlErrorCode.UnexpectedEof;
        } else if (e instanceof MismatchedTokenException || e instanceof NotAllInputParsedException) {
            code = SqlErrorCode.MissingKeyword;
        } else if (e.message.includes('Expected') || e.message.includes('expecting')) {
            code = SqlErrorCode.MissingKeyword;
        }

        errors.push({
            code,
            message: e.message,
            range,
        });
    }

    // Iterative parsing can still create a deep AST (for example, a long left-associative operator chain).
    if (exceedsAstDepth(ast)) {
        errors.push({
            code: SqlErrorCode.QueryTooComplex,
            message: `Query exceeds the maximum AST depth of ${MAX_AST_DEPTH}.`,
            range: { start: positionAt(0), end: positionAt(query.length) },
        });
        ast = undefined;
    }

    return { ast, errors };
}
