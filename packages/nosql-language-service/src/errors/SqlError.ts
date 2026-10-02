/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module errors/SqlError
 * Source location types and structured parse error definitions.
 * Every AST node carries an optional {@link SourceRange} for mapping
 * back to the original query text.
 */

/**
 * A position within the source query string.
 * Used as the start/end of a {@link SourceRange}.
 */
export interface SourcePosition {
    /** 0-based UTF-16 code-unit offset in the input string */
    offset: number;
    /** 1-based line number */
    line: number;
    /** 1-based UTF-16 code-unit column number (tabs count as one unit) */
    col: number;
}

/**
 * A contiguous range of text within the source query.
 * Optional on AST nodes and present on every parse error. The end is exclusive;
 * an EOF error has a zero-width range at the input length.
 */
export interface SourceRange {
    /** Inclusive start position */
    start: SourcePosition;
    /** Exclusive end position */
    end: SourcePosition;
}

/**
 * Typed error codes returned by the parser.
 * Useful for programmatic error handling, localization, or
 * mapping to Monaco marker severities.
 */
export enum SqlErrorCode {
    /** A token was found where another was expected */
    UnexpectedToken = 'UNEXPECTED_TOKEN',
    /** A required keyword (e.g. `FROM`, `BY`) is missing */
    MissingKeyword = 'MISSING_KEYWORD',
    /** Input ended unexpectedly (incomplete query) */
    UnexpectedEof = 'UNEXPECTED_EOF',
    /** A literal value could not be parsed (e.g. malformed number) */
    InvalidLiteral = 'INVALID_LITERAL',
    /** Parser rule nesting or AST depth exceeded the supported limits */
    QueryTooComplex = 'QUERY_TOO_COMPLEX',
}

/**
 * A single structured parse error.
 * The parser may return multiple errors per query thanks to
 * error recovery — each one pinpoints the location and kind.
 */
export interface SqlParseError {
    /** Machine-readable error classification */
    code: SqlErrorCode;
    /** Human-readable error description */
    message: string;
    /** Where in the source the error was detected */
    range: SourceRange;
}
