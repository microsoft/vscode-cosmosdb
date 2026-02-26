/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extracts structural DDL statements from SQL schema files, stripping data inserts,
 * comments, and non-structural content to reduce token count while preserving
 * the schema information needed for access pattern analysis.
 *
 * Supported statements: CREATE TABLE, ALTER TABLE, CREATE INDEX, CREATE VIEW,
 * CREATE PROCEDURE/FUNCTION, foreign key and constraint definitions.
 */

/** Patterns that mark the start of a structural DDL statement (case-insensitive). */
const DDL_START_PATTERNS = [
    /^\s*CREATE\s+TABLE\b/i,
    /^\s*CREATE\s+(?:UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+)?INDEX\b/i,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|PROC|FUNCTION|TRIGGER)\b/i,
    /^\s*ALTER\s+TABLE\b/i,
];

/** Lines to always skip (data, transaction noise, comments). */
const SKIP_PATTERNS = [
    /^\s*INSERT\s+/i,
    /^\s*UPDATE\s+/i,
    /^\s*DELETE\s+/i,
    /^\s*EXEC(?:UTE)?\s+/i,
    /^\s*SET\s+/i,
    /^\s*USE\s+/i,
    /^\s*GO\s*$/i,
    /^\s*PRINT\s+/i,
    /^\s*BEGIN\s+TRANSACTION/i,
    /^\s*COMMIT/i,
    /^\s*ROLLBACK/i,
    /^\s*GRANT\s+/i,
    /^\s*REVOKE\s+/i,
    /^\s*DENY\s+/i,
];

/**
 * Extracts structural DDL from raw SQL content.
 *
 * Strategy:
 * 1. Strip block comments and single-line comments
 * 2. Walk line-by-line, capturing DDL statements delimited by semicolons
 *    or balanced parentheses (for CREATE TABLE bodies)
 * 3. Skip INSERT/UPDATE/DELETE/SET/EXEC and other non-structural statements
 * 4. Return only the structural DDL text
 */
export function extractStructuralDDL(rawSql: string): string {
    // Strip block comments (/* ... */)
    let sql = rawSql.replace(/\/\*[\s\S]*?\*\//g, '');

    // Strip single-line comments (-- ...)
    sql = sql.replace(/--.*$/gm, '');

    const lines = sql.split('\n');
    const extracted: string[] = [];
    let capturing = false;
    let currentStatement: string[] = [];
    let parenDepth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // If not currently capturing, check if this starts a DDL statement
        if (!capturing) {
            if (SKIP_PATTERNS.some((p) => p.test(trimmed))) continue;

            if (DDL_START_PATTERNS.some((p) => p.test(trimmed))) {
                capturing = true;
                currentStatement = [line];
                parenDepth = countParenDelta(trimmed);

                // Single-line statement ending with ;
                if (trimmed.endsWith(';') && parenDepth <= 0) {
                    extracted.push(currentStatement.join('\n'));
                    currentStatement = [];
                    capturing = false;
                    parenDepth = 0;
                }
                continue;
            }

            // Skip non-structural lines outside DDL blocks
            continue;
        }

        // Currently capturing a DDL statement
        currentStatement.push(line);
        parenDepth += countParenDelta(trimmed);

        // Statement ends with ; and all parens are closed
        if (trimmed.endsWith(';') && parenDepth <= 0) {
            extracted.push(currentStatement.join('\n'));
            currentStatement = [];
            capturing = false;
            parenDepth = 0;
        }
        // Also end on ) alone (some DDL doesn't use ;)
        else if (parenDepth <= 0 && /^\s*\)\s*;?\s*$/.test(trimmed)) {
            extracted.push(currentStatement.join('\n'));
            currentStatement = [];
            capturing = false;
            parenDepth = 0;
        }
    }

    // Flush any remaining captured statement
    if (currentStatement.length > 0) {
        extracted.push(currentStatement.join('\n'));
    }

    return extracted.join('\n\n');
}

function countParenDelta(line: string): number {
    let delta = 0;
    for (const ch of line) {
        if (ch === '(') delta++;
        else if (ch === ')') delta--;
    }
    return delta;
}
