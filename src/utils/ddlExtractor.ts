/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extracts structural DDL statements from SQL schema files, stripping data inserts,
 * comments, and non-structural content to reduce token count while preserving
 * the schema information needed for access pattern analysis.
 *
 * Supports multiple SQL dialects (SQL Server, MySQL/MariaDB, PostgreSQL, Oracle).
 *
 * Supported statements: CREATE TABLE, ALTER TABLE, CREATE INDEX, CREATE FULLTEXT INDEX,
 * CREATE VIEW, CREATE SEQUENCE, CREATE TYPE, CREATE DOMAIN, CREATE SCHEMA, and
 * foreign key/constraint definitions.
 *
 * Stored procedures, functions, and triggers are intentionally excluded — their
 * bodies contain dialect-specific syntax (DELIMITER, $$, PL/SQL) that cannot be
 * reliably parsed with a line-based approach. Use raw file reading for those.
 *
 * Post-processing applied to captured statements (to reduce token count for
 * large SQL Server / SSMS-exported schemas):
 *   - Storage/engine clauses removed: WITH (...), ON [filegroup], TEXTIMAGE_ON,
 *     FILESTREAM_ON, COLLATE, ROWGUIDCOL, NOT FOR REPLICATION
 *   - CREATE VIEW bodies replaced with a one-line "references" summary
 *   - CHECK constraints removed (kept for CREATE DOMAIN where they define the type)
 *   - Redundant ALTER TABLE re-enable statements (CHECK/NOCHECK CONSTRAINT) dropped
 *   - ALTER TABLE … ADD CONSTRAINT [CK_*] CHECK (...) statements dropped
 */

/** Patterns that mark the start of a structural DDL statement (case-insensitive). */
const DDL_START_PATTERNS = [
    /^\s*CREATE\s+TABLE\b/i,
    /^\s*CREATE\s+(?:UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+)?INDEX\b/i,
    /^\s*CREATE\s+FULLTEXT\s+INDEX\b/i,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i,
    /^\s*ALTER\s+TABLE\b/i,
    /^\s*CREATE\s+SEQUENCE\b/i,
    /^\s*CREATE\s+TYPE\b/i,
    /^\s*CREATE\s+DOMAIN\b/i,
    /^\s*CREATE\s+SCHEMA\b/i,
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
    /^\s*DROP\s+/i,
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

    // Strip single-line comments (-- ...) and MySQL # comments
    sql = sql.replace(/(?:--.*|#.*)$/gm, '');

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

    const processed: string[] = [];
    for (const stmt of extracted) {
        const out = postProcessStatement(stmt);
        if (out) processed.push(out);
    }

    return processed.join('\n\n');
}

/**
 * Applies post-capture transformations:
 *   - Drops bare ALTER TABLE … (NO)CHECK CONSTRAINT re-enable statements
 *   - Drops ALTER TABLE … ADD CONSTRAINT [CK_*] CHECK (...) statements
 *   - Summarizes CREATE VIEW bodies to a one-line table-reference list
 *   - Strips engine/storage clauses from all other statements
 *
 * Returns an empty string when the statement should be dropped entirely.
 */
function postProcessStatement(stmt: string): string {
    const head = stmt.replace(/^\s+/, '');

    // Drop redundant ALTER TABLE re-enable statements: CHECK / NOCHECK CONSTRAINT [FK_*]
    // Matches "ALTER TABLE … CHECK CONSTRAINT …" and "ALTER TABLE … NOCHECK CONSTRAINT …".
    if (/^ALTER\s+TABLE\b[\s\S]*?\b(?:NOCHECK|CHECK)\s+CONSTRAINT\b/i.test(head)) {
        return '';
    }

    // Drop ALTER TABLE … ADD CONSTRAINT [CK_*] CHECK (...) — CHECK constraints are noise
    if (/^ALTER\s+TABLE\b[\s\S]*?\bADD\s+CONSTRAINT\b[\s\S]*?\bCHECK\s*\(/i.test(head)) {
        return '';
    }

    // Summarize CREATE VIEW
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i.test(head)) {
        return summarizeView(head);
    }

    // CREATE DOMAIN keeps its CHECK clause (it defines the type); other statements drop it
    const preserveCheck = /^CREATE\s+DOMAIN\b/i.test(head);
    return stripStorageNoise(head, preserveCheck).trim();
}

/**
 * Replaces a CREATE VIEW body with a single-line summary listing tables
 * referenced via FROM/JOIN clauses.
 */
function summarizeView(stmt: string): string {
    const headerMatch = /^(CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+[^\s(]+(?:\s*\([^)]*\))?\s+AS)\b/i.exec(stmt);
    const header = headerMatch ? headerMatch[1] : stmt.split(/\bAS\b/i)[0].trim();

    const refs = new Set<string>();
    const refRegex = /\b(?:FROM|JOIN)\s+([A-Za-z_[][\w[\]]*(?:\.[A-Za-z_[][\w[\]]*)*)/gi;
    let m: RegExpExecArray | null;
    while ((m = refRegex.exec(stmt)) !== null) {
        refs.add(m[1]);
    }

    const refList = refs.size > 0 ? Array.from(refs).join(', ') : '(none detected)';
    return `${header} -- references: ${refList};`;
}

/**
 * Strips SQL Server engine/storage clauses that are irrelevant for migration:
 *   - WITH (...) option blocks (balanced-paren removal)
 *   - ON [PRIMARY] / TEXTIMAGE_ON / FILESTREAM_ON
 *   - COLLATE <collation>
 *   - ROWGUIDCOL, NOT FOR REPLICATION
 *   - Inline CHECK (...) constraints (unless preserveCheck is true, e.g. CREATE DOMAIN)
 */
function stripStorageNoise(stmt: string, preserveCheck: boolean): string {
    let s = stmt;

    // Balanced-paren strip of WITH (...) option blocks anywhere in the statement.
    // Safe because CTEs (WITH name AS (...)) don't match \bWITH\s*\(.
    s = stripBalancedBlocks(s, /\bWITH\s*\(/gi);

    if (!preserveCheck) {
        // Strip "[CONSTRAINT name] CHECK (...)" segments with balanced parens
        s = stripBalancedBlocks(s, /\b(?:CONSTRAINT\s+(?:\[[^\]]+\]|\w+)\s+)?CHECK\s*\(/gi);
    }

    // SQL Server filegroup / storage placement clauses
    s = s.replace(/\s+ON\s+\[PRIMARY\]/gi, '');
    s = s.replace(/\s+TEXTIMAGE_ON\s+\[?\w+\]?/gi, '');
    s = s.replace(/\s+FILESTREAM_ON\s+\[?\w+\]?/gi, '');

    // Column-level noise
    s = s.replace(/\s+COLLATE\s+\w+/gi, '');
    s = s.replace(/\s+ROWGUIDCOL\b/gi, '');
    s = s.replace(/\s+NOT\s+FOR\s+REPLICATION\b/gi, '');

    // Cleanup whitespace and stray separators left by stripping
    s = s.replace(/[ \t]+/g, ' ');
    s = s.replace(/[ \t]+\n/g, '\n');
    s = s.replace(/,\s*,/g, ',');
    s = s.replace(/,(\s*\))/g, '$1');

    return s;
}

/**
 * Removes every match of `startPattern` together with its matching parenthesized
 * block (balanced parens, including nested). The pattern must end with `(` so the
 * opening paren of the block is the last character of the match.
 */
function stripBalancedBlocks(s: string, startPattern: RegExp): string {
    let result = '';
    let lastEnd = 0;
    const flags = startPattern.flags.includes('g') ? startPattern.flags : startPattern.flags + 'g';
    const re = new RegExp(startPattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        const matchStart = m.index;
        const openParenIdx = matchStart + m[0].length - 1;
        if (s[openParenIdx] !== '(') {
            re.lastIndex = matchStart + 1;
            continue;
        }
        let depth = 1;
        let j = openParenIdx + 1;
        for (; j < s.length; j++) {
            const ch = s[j];
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) {
                    j++;
                    break;
                }
            }
        }
        // Trim whitespace immediately preceding the strip site
        let cutStart = matchStart;
        while (cutStart > lastEnd && /\s/.test(s[cutStart - 1])) cutStart--;
        result += s.slice(lastEnd, cutStart);
        lastEnd = j;
        re.lastIndex = j;
    }
    result += s.slice(lastEnd);
    return result;
}

function countParenDelta(line: string): number {
    let delta = 0;
    for (const ch of line) {
        if (ch === '(') delta++;
        else if (ch === ')') delta--;
    }
    return delta;
}
