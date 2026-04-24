/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module errors/SqlErrorMessageProvider
 *
 * Custom Chevrotain {@link IParserErrorMessageProvider} that rewrites raw
 * token-based error messages into human-readable form.
 *
 * Instead of "Expecting token of type 'LParen' but found …" users see
 * "Expected '(' but found …".
 */

import { type IParserErrorMessageProvider, type IToken, type TokenType } from 'chevrotain';
import { EOF } from 'chevrotain';

// ---------------------------------------------------------------------------
// Token display-name mapping
// ---------------------------------------------------------------------------

/**
 * Maps internal Chevrotain token names to user-friendly labels.
 * Keywords (all-uppercase names like SELECT, FROM) are kept as-is.
 */
const TOKEN_DISPLAY_NAMES: Record<string, string> = {
    Identifier: 'name',
    LParen: "'('",
    RParen: "')'",
    LBracket: "'['",
    RBracket: "']'",
    LBrace: "'{'",
    RBrace: "'}'",
    Dot: "'.'",
    Comma: "','",
    Semicolon: "';'",
    Colon: "':'",
    Star: "'*'",
    Equals: "'='",
    NotEqual: "'!=' or '<>'",
    LessThan: "'<'",
    GreaterThan: "'>'",
    LessThanEqual: "'<='",
    GreaterThanEqual: "'>='",
    Plus: "'+'",
    Minus: "'-'",
    Slash: "'/'",
    Percent: "'%'",
    Ampersand: "'&'",
    Pipe: "'|'",
    Caret: "'^'",
    Tilde: "'~'",
    Bang: "'!'",
    Question: "'?'",
    LeftShift: "'<<'",
    RightShift: "'>>'",
    RightShiftZF: "'>>>'",
    StringConcat: "'||'",
    Coalesce: "'??'",
    StringLiteral: 'string',
    NumberLiteral: 'number',
    IntegerLiteral: 'integer',
    DoubleLiteral: 'decimal number',
    Parameter: '@parameter',
    EOF: 'end of query',
};

/**
 * Return a human-readable label for a token type.
 * Keywords are returned in uppercase (e.g. "SELECT").
 */
function tokenLabel(tokenType: TokenType): string {
    if (tokenType === EOF) {
        return 'end of query';
    }
    const mapped = TOKEN_DISPLAY_NAMES[tokenType.name];
    if (mapped) {
        return mapped;
    }
    // Keywords: their name is already uppercase (e.g. "SELECT", "FROM")
    // Return as-is if all-upper or looks like a keyword
    return tokenType.name;
}

/**
 * Return a human-readable representation of an actual token's image.
 * For EOF or empty images, returns "end of query".
 */
function actualTokenDisplay(token: IToken): string {
    if (token.tokenType === EOF || !token.image) {
        return 'end of query';
    }
    return `'${token.image}'`;
}

// ---------------------------------------------------------------------------
// Deduplication & simplification helpers
// ---------------------------------------------------------------------------

/**
 * Given the Chevrotain `expectedPathsPerAlt` (alternatives of paths of token types),
 * flatten to a deduplicated list of human-readable labels, looking only at the
 * first token of each path (which is enough for a concise message).
 */
function uniqueExpectedLabels(expectedPathsPerAlt: TokenType[][][]): string[] {
    const seen = new Set<string>();
    const labels: string[] = [];

    for (const paths of expectedPathsPerAlt) {
        for (const path of paths) {
            if (path.length === 0) continue;
            const label = tokenLabel(path[0]);
            if (!seen.has(label)) {
                seen.add(label);
                labels.push(label);
            }
        }
    }
    return labels;
}

/**
 * Format a list of expected labels into a readable string.
 * Shows up to `maxItems` items; appends "..." if truncated.
 */
function formatExpectedList(labels: string[], maxItems = 5): string {
    if (labels.length === 0) {
        return 'expression';
    }
    if (labels.length === 1) {
        return labels[0];
    }
    const shown = labels.slice(0, maxItems);
    const rest = labels.length > maxItems ? ', ...' : '';
    const last = shown.pop()!;
    return `${shown.join(', ')}, or ${last}${rest}`;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

/**
 * Custom error message provider for the CosmosDB NoSQL SQL parser.
 *
 * Implements Chevrotain's `IParserErrorMessageProvider` to produce
 * user-friendly error messages instead of raw token type names.
 */
export class SqlErrorMessageProvider implements IParserErrorMessageProvider {
    /**
     * "Expected X but found Y."
     */
    buildMismatchTokenMessage(options: {
        expected: TokenType;
        actual: IToken;
        previous: IToken;
        ruleName: string;
    }): string {
        const expected = tokenLabel(options.expected);
        const actual = actualTokenDisplay(options.actual);
        return `Expected ${expected} but found ${actual}.`;
    }

    /**
     * "Unexpected X after the query."
     */
    buildNotAllInputParsedMessage(options: { firstRedundant: IToken; ruleName: string }): string {
        const found = actualTokenDisplay(options.firstRedundant);
        return `Unexpected ${found} after the query.`;
    }

    /**
     * "Unexpected X. Expected A, B, or C."
     */
    buildNoViableAltMessage(options: {
        expectedPathsPerAlt: TokenType[][][];
        actual: IToken[];
        previous: IToken;
        customUserDescription?: string;
        ruleName: string;
    }): string {
        if (options.customUserDescription) {
            return options.customUserDescription;
        }
        const actual =
            options.actual.length > 0 ? actualTokenDisplay(options.actual[0]) : 'end of query';
        const labels = uniqueExpectedLabels(options.expectedPathsPerAlt);
        const expected = formatExpectedList(labels);
        return `Unexpected ${actual}. Expected ${expected}.`;
    }

    /**
     * "Expected at least one X after Y."
     */
    buildEarlyExitMessage(options: {
        expectedIterationPaths: TokenType[][];
        actual: IToken[];
        previous: IToken;
        customUserDescription?: string;
        ruleName: string;
    }): string {
        if (options.customUserDescription) {
            return options.customUserDescription;
        }

        // Collect first tokens from each expected path
        const seen = new Set<string>();
        const labels: string[] = [];
        for (const path of options.expectedIterationPaths) {
            if (path.length === 0) continue;
            const label = tokenLabel(path[0]);
            if (!seen.has(label)) {
                seen.add(label);
                labels.push(label);
            }
        }

        const expected = formatExpectedList(labels);
        const after = actualTokenDisplay(options.previous);
        return `Expected at least one ${expected} after ${after}.`;
    }
}

