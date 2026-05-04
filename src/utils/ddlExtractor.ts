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
 * CREATE BITMAP INDEX, CREATE VIEW, CREATE MATERIALIZED VIEW, CREATE FOREIGN TABLE,
 * CREATE SEQUENCE, CREATE TYPE, CREATE DOMAIN, CREATE SCHEMA, CREATE EXTENSION,
 * COMMENT ON, and foreign key/constraint definitions.
 *
 * Stored procedures, functions, triggers, packages, synonyms, clusters, database
 * links, and Oracle global temporary tables are intentionally excluded — their
 * bodies/contents are not migration-relevant.
 *
 * Post-processing applied to captured statements (to reduce token count for large
 * SQL Server / pg_dump / mysqldump / Oracle expdp exports):
 *   - Storage/engine clauses removed:
 *       * SQL Server: WITH (...), ON [filegroup], TEXTIMAGE_ON, FILESTREAM_ON,
 *         COLLATE, ROWGUIDCOL, NOT FOR REPLICATION
 *       * PostgreSQL: WITH (...), TABLESPACE, COLLATE "..."
 *       * MySQL: trailing ENGINE/CHARSET/AUTO_INCREMENT/ROW_FORMAT/PACK_KEYS/
 *         STATS_PERSISTENT/COMMENT/COLLATE table options, inline column COMMENT '...'
 *       * Oracle: STORAGE (...), USING INDEX (...), PCTFREE/PCTUSED/INITRANS/MAXTRANS,
 *         SEGMENT CREATION DEFERRED|IMMEDIATE, NOCOMPRESS/COMPRESS, [NO]LOGGING,
 *         [NO]CACHE, [NO]PARALLEL, ENABLE/DISABLE [NO]VALIDATE, DEFERRABLE/INITIALLY ...
 *   - CREATE VIEW and CREATE MATERIALIZED VIEW bodies replaced with a one-line
 *     "references" summary
 *   - CHECK constraints removed (kept for CREATE DOMAIN where they define the type)
 *   - Redundant ALTER TABLE re-enable statements (CHECK/NOCHECK CONSTRAINT) dropped
 *   - ALTER TABLE … ADD CONSTRAINT [CK_*] CHECK (...) statements dropped
 *   - ALTER ... OWNER TO, ALTER SEQUENCE ... OWNED BY, ALTER TABLE ... REPLICA IDENTITY dropped
 *   - COMMENT ON statements with comment text > 200 chars dropped
 */

/** Patterns that mark the start of a structural DDL statement (case-insensitive). */
const DDL_START_PATTERNS = [
    /^\s*CREATE\s+TABLE\b/i,
    /^\s*CREATE\s+(?:UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+|BITMAP\s+)?INDEX\b/i,
    /^\s*CREATE\s+FULLTEXT\s+INDEX\b/i,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FORCE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?VIEW\b/i,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\b/i,
    /^\s*CREATE\s+FOREIGN\s+TABLE\b/i,
    /^\s*ALTER\s+TABLE\b/i,
    /^\s*CREATE\s+SEQUENCE\b/i,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TYPE\b/i,
    /^\s*CREATE\s+DOMAIN\b/i,
    /^\s*CREATE\s+SCHEMA\b/i,
    /^\s*CREATE\s+EXTENSION\b/i,
    /^\s*COMMENT\s+ON\b/i,
];

/**
 * Lines to always skip (data, transaction noise, dump preludes, non-structural objects).
 * Evaluated before DDL_START_PATTERNS so that, for example,
 * `CREATE MATERIALIZED VIEW LOG` pre-empts the matview start pattern.
 */
const SKIP_PATTERNS = [
    // Data ops
    /^\s*INSERT\s+/i,
    /^\s*UPDATE\s+/i,
    /^\s*DELETE\s+/i,
    /^\s*MERGE\s+/i,
    // Procedural / session
    /^\s*EXEC(?:UTE)?\s+/i,
    /^\s*SET\s+/i,
    /^\s*USE\s+/i,
    /^\s*GO\s*$/i,
    /^\s*PRINT\s+/i,
    /^\s*BEGIN\s+TRANSACTION/i,
    /^\s*COMMIT/i,
    /^\s*ROLLBACK/i,
    // Permissions / lifecycle
    /^\s*GRANT\s+/i,
    /^\s*REVOKE\s+/i,
    /^\s*DENY\s+/i,
    /^\s*DROP\s+/i,
    // PostgreSQL / pg_dump prelude and data
    /^\s*SELECT\s+pg_catalog\./i,
    /^\s*\\\w/, // psql backslash meta-commands (\connect, \restrict, etc.)
    // MySQL / mysqldump
    /^\s*LOCK\s+TABLES?\b/i,
    /^\s*UNLOCK\s+TABLES?\b/i,
    /^\s*DELIMITER\b/i,
    // Oracle / SQL*Plus
    /^\s*PROMPT\b/i,
    /^\s*SPOOL\b/i,
    /^\s*WHENEVER\b/i,
    /^\s*REM\b/i,
    /^\s*CONNECT\b/i,
    // Non-structural object kinds (intentionally not migrated)
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:PUBLIC\s+)?SYNONYM\b/i,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?PACKAGE\b/i,
    /^\s*CREATE\s+CLUSTER\b/i,
    /^\s*ALTER\s+CLUSTER\b/i,
    /^\s*CREATE\s+DATABASE\s+LINK\b/i,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\s+LOG\b/i, // must precede matview start
    /^\s*CREATE\s+GLOBAL\s+TEMPORARY\s+TABLE\b/i, // session-scoped scratch space
    /^\s*CREATE\s+PUBLICATION\b/i,
    /^\s*CREATE\s+SUBSCRIPTION\b/i,
];

/**
 * Per-statement-type counters describing the surviving extracted DDL.
 * Statements that are dropped during post-processing do NOT count here.
 */
export interface StatementCounts {
    createTable: number;
    alterTable: number;
    createIndex: number;
    createFulltextIndex: number;
    createView: number;
    createMaterializedView: number;
    createForeignTable: number;
    createSequence: number;
    createType: number;
    createDomain: number;
    createSchema: number;
    createExtension: number;
    commentOn: number;
    /** Captured statements that didn't match any of the above classifiers. */
    other: number;
}

/** Counters for statements deliberately dropped during post-processing. */
export interface DropCounts {
    /** ALTER TABLE … (NO)CHECK CONSTRAINT [FK_*] re-enable noise. */
    alterTableCheckReenable: number;
    /** ALTER TABLE … ADD CONSTRAINT [CK_*] CHECK (...) value-domain checks. */
    alterTableCheckConstraint: number;
    /** ALTER ... OWNER TO ... (PostgreSQL/Oracle ownership). */
    alterOwnerTo: number;
    /** ALTER SEQUENCE ... OWNED BY ... */
    alterSequenceOwnedBy: number;
    /** ALTER TABLE ... REPLICA IDENTITY ... */
    alterTableReplicaIdentity: number;
    /** COMMENT ON ... statements whose comment text exceeded the length cap. */
    commentTooLong: number;
}

/** Counters for noise clauses removed from kept statements. */
export interface StripCounts {
    withOptionBlocks: number;
    inlineCheckConstraints: number;
    onPrimary: number;
    textImageOn: number;
    fileStreamOn: number;
    collate: number;
    rowGuidCol: number;
    notForReplication: number;
    /** TABLESPACE <name> (PostgreSQL/Oracle). */
    tablespace: number;
    /** Oracle STORAGE (...) blocks. */
    oracleStorageBlocks: number;
    /** Oracle USING INDEX (...) blocks attached to constraints. */
    oracleUsingIndexBlocks: number;
    /** Oracle trailing storage keywords (PCTFREE, NOLOGGING, NOCACHE, etc.). */
    oracleStorageKeywords: number;
    /** Oracle constraint state (ENABLE/DISABLE [NO]VALIDATE, DEFERRABLE, ...). */
    oracleConstraintState: number;
    /** MySQL trailing CREATE TABLE options (ENGINE=, AUTO_INCREMENT=, etc.). */
    mysqlTableOptions: number;
    /** MySQL inline column COMMENT '...' clauses. */
    mysqlInlineComment: number;
}

/** Counters for CREATE VIEW summarization. */
export interface ViewCounts {
    summarized: number;
    /** Sum of distinct table references across all summarized views. */
    referencedTablesTotal: number;
}

/** Result of an extraction call. Returned alongside the cleaned SQL string. */
export interface ExtractionStats {
    inputChars: number;
    outputChars: number;
    /** 1 - outputChars/inputChars; clamped to [0, 1]. 0 when input is empty. */
    reductionRatio: number;
    durationMs: number;
    statementCounts: StatementCounts;
    drops: DropCounts;
    strips: StripCounts;
    views: ViewCounts;
    /** Anomalies worth logging (e.g. unterminated statement flushed at EOF). */
    warnings: string[];
}

export interface ExtractionResult {
    sql: string;
    stats: ExtractionStats;
}

function emptyStats(): ExtractionStats {
    return {
        inputChars: 0,
        outputChars: 0,
        reductionRatio: 0,
        durationMs: 0,
        statementCounts: {
            createTable: 0,
            alterTable: 0,
            createIndex: 0,
            createFulltextIndex: 0,
            createView: 0,
            createMaterializedView: 0,
            createForeignTable: 0,
            createSequence: 0,
            createType: 0,
            createDomain: 0,
            createSchema: 0,
            createExtension: 0,
            commentOn: 0,
            other: 0,
        },
        drops: {
            alterTableCheckReenable: 0,
            alterTableCheckConstraint: 0,
            alterOwnerTo: 0,
            alterSequenceOwnedBy: 0,
            alterTableReplicaIdentity: 0,
            commentTooLong: 0,
        },
        strips: {
            withOptionBlocks: 0,
            inlineCheckConstraints: 0,
            onPrimary: 0,
            textImageOn: 0,
            fileStreamOn: 0,
            collate: 0,
            rowGuidCol: 0,
            notForReplication: 0,
            tablespace: 0,
            oracleStorageBlocks: 0,
            oracleUsingIndexBlocks: 0,
            oracleStorageKeywords: 0,
            oracleConstraintState: 0,
            mysqlTableOptions: 0,
            mysqlInlineComment: 0,
        },
        views: { summarized: 0, referencedTablesTotal: 0 },
        warnings: [],
    };
}

/**
 * Extracts structural DDL from raw SQL content.
 *
 * Returns both the cleaned SQL string and rich statistics about the
 * transformation (input/output sizes, statement counts, noise stripped,
 * anomalies). Callers that only care about the string should read `.sql`.
 *
 * Strategy:
 * 1. Strip block comments and single-line comments
 * 2. Walk line-by-line, capturing DDL statements delimited by semicolons
 *    or balanced parentheses (for CREATE TABLE bodies)
 * 3. Skip INSERT/UPDATE/DELETE/SET/EXEC and other non-structural statements
 * 4. Post-process each captured statement: drop noise, strip storage clauses,
 *    summarize view bodies — incrementing stats counters along the way
 */
export function extractStructuralDDL(rawSql: string): ExtractionResult {
    const startedAt = Date.now();
    const stats = emptyStats();
    stats.inputChars = rawSql.length;

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
        stats.warnings.push('Unterminated DDL statement flushed at end of input.');
    }

    const processed: string[] = [];
    for (const stmt of extracted) {
        const out = postProcessStatement(stmt, stats);
        if (out) processed.push(out);
    }

    const sqlOut = processed.join('\n\n');
    stats.outputChars = sqlOut.length;
    stats.reductionRatio =
        stats.inputChars > 0 ? Math.max(0, Math.min(1, 1 - stats.outputChars / stats.inputChars)) : 0;
    stats.durationMs = Date.now() - startedAt;

    return { sql: sqlOut, stats };
}

/**
 * Applies post-capture transformations and updates `stats`:
 *   - Drops bare ALTER TABLE … (NO)CHECK CONSTRAINT re-enable statements
 *   - Drops ALTER TABLE … ADD CONSTRAINT [CK_*] CHECK (...) statements
 *   - Summarizes CREATE VIEW bodies to a one-line table-reference list
 *   - Strips engine/storage clauses from all other statements
 *
 * Returns an empty string when the statement should be dropped entirely.
 */
function postProcessStatement(stmt: string, stats: ExtractionStats): string {
    const head = stmt.replace(/^\s+/, '');

    // Drop redundant ALTER TABLE re-enable statements: CHECK / NOCHECK CONSTRAINT [FK_*]
    if (/^ALTER\s+TABLE\b[\s\S]*?\b(?:NOCHECK|CHECK)\s+CONSTRAINT\b/i.test(head)) {
        stats.drops.alterTableCheckReenable++;
        return '';
    }

    // Drop ALTER TABLE … ADD CONSTRAINT [CK_*] CHECK (...) — CHECK constraints are noise
    if (/^ALTER\s+TABLE\b[\s\S]*?\bADD\s+CONSTRAINT\b[\s\S]*?\bCHECK\s*\(/i.test(head)) {
        stats.drops.alterTableCheckConstraint++;
        return '';
    }

    // Drop ALTER ... OWNER TO ... (PostgreSQL/Oracle ownership noise)
    if (
        /^ALTER\s+(?:TABLE|SEQUENCE|VIEW|MATERIALIZED\s+VIEW|TYPE|FUNCTION|INDEX|SCHEMA|FOREIGN\s+TABLE)\b[\s\S]*?\bOWNER\s+TO\b/i.test(
            head,
        )
    ) {
        stats.drops.alterOwnerTo++;
        return '';
    }

    // Drop ALTER SEQUENCE ... OWNED BY ... (sequence-to-column linkage; redundant)
    if (/^ALTER\s+SEQUENCE\b[\s\S]*?\bOWNED\s+BY\b/i.test(head)) {
        stats.drops.alterSequenceOwnedBy++;
        return '';
    }

    // Drop ALTER TABLE ... REPLICA IDENTITY ... (logical replication tuning)
    if (/^ALTER\s+TABLE\b[\s\S]*?\bREPLICA\s+IDENTITY\b/i.test(head)) {
        stats.drops.alterTableReplicaIdentity++;
        return '';
    }

    // COMMENT ON ... — drop only if the comment string exceeds the length cap
    if (/^COMMENT\s+ON\b/i.test(head)) {
        const lit = extractFirstStringLiteral(head);
        if (lit !== undefined && lit.length > MAX_COMMENT_TEXT_LENGTH) {
            stats.drops.commentTooLong++;
            return '';
        }
        // Keep COMMENT ON as-is (single line, low cost)
        stats.statementCounts.commentOn++;
        return head.trimEnd();
    }

    // Summarize CREATE [MATERIALIZED] VIEW
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FORCE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?VIEW\b/i.test(head)) {
        const result = summarizeView(head, /* materialized */ false);
        stats.views.summarized++;
        stats.views.referencedTablesTotal += result.refCount;
        stats.statementCounts.createView++;
        return result.line;
    }
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\b/i.test(head)) {
        const result = summarizeView(head, /* materialized */ true);
        stats.views.summarized++;
        stats.views.referencedTablesTotal += result.refCount;
        stats.statementCounts.createMaterializedView++;
        return result.line;
    }

    // CREATE DOMAIN keeps its CHECK clause (it defines the type); other statements drop it
    const preserveCheck = /^CREATE\s+DOMAIN\b/i.test(head);
    const cleaned = stripStorageNoise(head, preserveCheck, stats).trim();

    classifyKeptStatement(head, stats);
    return cleaned;
}

/** Maximum length (in characters) for COMMENT ON literals before the statement is dropped. */
const MAX_COMMENT_TEXT_LENGTH = 200;

/**
 * Returns the contents of the first single- or double-quoted string literal in `s`,
 * or `undefined` if none is found. Handles standard SQL doubled-quote escapes
 * (`'It''s OK'`).
 */
function extractFirstStringLiteral(s: string): string | undefined {
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch !== "'" && ch !== '"') continue;
        const quote = ch;
        let buf = '';
        let j = i + 1;
        while (j < s.length) {
            if (s[j] === quote) {
                if (s[j + 1] === quote) {
                    buf += quote;
                    j += 2;
                    continue;
                }
                return buf;
            }
            buf += s[j];
            j++;
        }
        return buf; // unterminated — treat what we have as the literal
    }
    return undefined;
}

/** Increments `stats.statementCounts` based on the leading keywords of a kept statement. */
function classifyKeptStatement(head: string, stats: ExtractionStats): void {
    const c = stats.statementCounts;
    if (/^CREATE\s+TABLE\b/i.test(head)) c.createTable++;
    else if (/^CREATE\s+FOREIGN\s+TABLE\b/i.test(head)) c.createForeignTable++;
    else if (/^ALTER\s+TABLE\b/i.test(head)) c.alterTable++;
    else if (/^CREATE\s+FULLTEXT\s+INDEX\b/i.test(head)) c.createFulltextIndex++;
    else if (/^CREATE\s+(?:UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+|BITMAP\s+)?INDEX\b/i.test(head)) c.createIndex++;
    else if (/^CREATE\s+SEQUENCE\b/i.test(head)) c.createSequence++;
    else if (/^CREATE\s+(?:OR\s+REPLACE\s+)?TYPE\b/i.test(head)) c.createType++;
    else if (/^CREATE\s+DOMAIN\b/i.test(head)) c.createDomain++;
    else if (/^CREATE\s+SCHEMA\b/i.test(head)) c.createSchema++;
    else if (/^CREATE\s+EXTENSION\b/i.test(head)) c.createExtension++;
    else c.other++;
}

/**
 * Replaces a CREATE VIEW (or CREATE MATERIALIZED VIEW) body with a single-line
 * summary listing tables referenced via FROM/JOIN clauses.
 */
function summarizeView(stmt: string, materialized: boolean): { line: string; refCount: number } {
    const headerRegex = materialized
        ? /^(CREATE\s+(?:OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\s+[^\s(]+(?:\s*\([^)]*\))?\s+AS)\b/i
        : /^(CREATE\s+(?:OR\s+REPLACE\s+)?(?:FORCE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?VIEW\s+[^\s(]+(?:\s*\([^)]*\))?\s+AS)\b/i;
    const headerMatch = headerRegex.exec(stmt);
    const header = headerMatch ? headerMatch[1] : stmt.split(/\bAS\b/i)[0].trim();

    // Identifier may be: bare, [bracketed], "double-quoted", `backticked`, schema-qualified
    const refRegex =
        /\b(?:FROM|JOIN)\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_]\w*)(?:\.(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_]\w*))*)/gi;
    const refs = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = refRegex.exec(stmt)) !== null) {
        refs.add(m[1]);
    }

    const refList = refs.size > 0 ? Array.from(refs).join(', ') : '(none detected)';
    return { line: `${header} -- references: ${refList};`, refCount: refs.size };
}

/**
 * Strips engine/storage clauses across all supported dialects and updates
 * the relevant `stats.strips` counters. See file header for the full list.
 */
function stripStorageNoise(stmt: string, preserveCheck: boolean, stats: ExtractionStats): string {
    let s = stmt;

    // Balanced-paren strip of WITH (...) option blocks anywhere in the statement.
    // Safe because CTEs (WITH name AS (...)) don't match \bWITH\s*\(.
    {
        const r = stripBalancedBlocks(s, /\bWITH\s*\(/gi);
        s = r.s;
        stats.strips.withOptionBlocks += r.removed;
    }

    // Oracle STORAGE (...) blocks (top-level or attached to constraints/indexes).
    {
        const r = stripBalancedBlocks(s, /\bSTORAGE\s*\(/gi);
        s = r.s;
        stats.strips.oracleStorageBlocks += r.removed;
    }

    // Oracle USING INDEX (...) — storage clause attached to constraints.
    // Only the parenthesized form is balanced-stripped here; the bare
    // "USING INDEX <name>" form is left intact (it carries the index name).
    {
        const r = stripBalancedBlocks(s, /\bUSING\s+INDEX\s*\(/gi);
        s = r.s;
        stats.strips.oracleUsingIndexBlocks += r.removed;
    }

    if (!preserveCheck) {
        // Strip "[CONSTRAINT name] CHECK (...)" segments with balanced parens
        const r = stripBalancedBlocks(s, /\b(?:CONSTRAINT\s+(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|\w+)\s+)?CHECK\s*\(/gi);
        s = r.s;
        stats.strips.inlineCheckConstraints += r.removed;
    }

    // SQL Server filegroup / storage placement clauses
    s = countingReplace(s, /\s+ON\s+\[PRIMARY\]/gi, (n) => (stats.strips.onPrimary += n));
    s = countingReplace(s, /\s+TEXTIMAGE_ON\s+\[?\w+\]?/gi, (n) => (stats.strips.textImageOn += n));
    s = countingReplace(s, /\s+FILESTREAM_ON\s+\[?\w+\]?/gi, (n) => (stats.strips.fileStreamOn += n));

    // PostgreSQL / Oracle TABLESPACE placement
    s = countingReplace(s, /\s+TABLESPACE\s+(?:"[^"]+"|`[^`]+`|\w+)/gi, (n) => (stats.strips.tablespace += n));

    // Column-level / inline noise (collation now allows quoted/backticked names)
    s = countingReplace(s, /\s+COLLATE\s+(?:"[^"]+"|`[^`]+`|\w+)/gi, (n) => (stats.strips.collate += n));
    // MySQL CHARACTER SET <name> — independent of COLLATE; treat as collation noise.
    s = countingReplace(s, /\s+CHARACTER\s+SET\s+(?:"[^"]+"|`[^`]+`|\w+)/gi, (n) => (stats.strips.collate += n));
    s = countingReplace(s, /\s+ROWGUIDCOL\b/gi, (n) => (stats.strips.rowGuidCol += n));
    s = countingReplace(s, /\s+NOT\s+FOR\s+REPLICATION\b/gi, (n) => (stats.strips.notForReplication += n));

    // Oracle trailing storage keywords (table & index level).
    s = countingReplace(
        s,
        new RegExp(
            '\\s+(?:' +
                'SEGMENT\\s+CREATION\\s+(?:DEFERRED|IMMEDIATE)' +
                '|PCT(?:FREE|USED|INCREASE)\\s+\\d+' +
                '|INI(?:T|TIAL)?TRANS\\s+\\d+' +
                '|MAXTRANS\\s+\\d+' +
                '|N?O?LOGGING' +
                '|N?O?CACHE' +
                '|N?O?MONITORING' +
                '|N?O?COMPRESS(?:\\s+(?:BASIC|FOR\\s+\\w+(?:\\s+\\w+)?))?' +
                '|N?O?PARALLEL(?:\\s*\\(\\s*DEGREE\\s+\\d+\\s*\\))?' +
                '|BUFFER_POOL\\s+(?:DEFAULT|KEEP|RECYCLE)' +
                '|FLASH_CACHE\\s+(?:DEFAULT|KEEP|NONE)' +
                '|CELL_FLASH_CACHE\\s+(?:DEFAULT|KEEP|NONE)' +
                ')\\b',
            'gi',
        ),
        (n) => (stats.strips.oracleStorageKeywords += n),
    );

    // Oracle constraint state suffixes
    s = countingReplace(
        s,
        /\s+(?:ENABLE|DISABLE)(?:\s+(?:NOVALIDATE|VALIDATE))?\b/gi,
        (n) => (stats.strips.oracleConstraintState += n),
    );
    s = countingReplace(
        s,
        /\s+(?:DEFERRABLE|NOT\s+DEFERRABLE|INITIALLY\s+DEFERRED|INITIALLY\s+IMMEDIATE)\b/gi,
        (n) => (stats.strips.oracleConstraintState += n),
    );

    // MySQL inline column COMMENT '...' — strip the CHARACTER SET/COLLATE-style noise on columns.
    // Doesn't touch standalone COMMENT ON statements (those are handled elsewhere).
    s = countingReplace(s, /\s+COMMENT\s+'(?:''|[^'])*'/gi, (n) => (stats.strips.mysqlInlineComment += n));

    // MySQL trailing CREATE TABLE options (after the closing `)` of the column list).
    // Single regex matches any sequence of KEY=VALUE option pairs, possibly followed by ENGINE etc.
    {
        const optionRe =
            /\)\s*((?:(?:DEFAULT\s+)?(?:ENGINE|CHARSET|CHARACTER\s+SET|COLLATE|AUTO_INCREMENT|ROW_FORMAT|PACK_KEYS|STATS_PERSISTENT|STATS_AUTO_RECALC|STATS_SAMPLE_PAGES|KEY_BLOCK_SIZE|MAX_ROWS|MIN_ROWS|AVG_ROW_LENGTH|TABLESPACE|COMMENT)\s*=\s*(?:'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:[^`]|``)+`|\S+)\s*,?\s*)+)/i;
        const m2 = optionRe.exec(s);
        if (m2) {
            stats.strips.mysqlTableOptions++;
            s = s.slice(0, m2.index + 1) + s.slice(m2.index + m2[0].length);
        }
    }

    // Cleanup whitespace and stray separators left by stripping
    s = s.replace(/[ \t]+/g, ' ');
    s = s.replace(/[ \t]+\n/g, '\n');
    s = s.replace(/,\s*,/g, ',');
    s = s.replace(/,(\s*\))/g, '$1');

    return s;
}

/** Replace + count occurrences via the supplied counter callback. */
function countingReplace(s: string, pattern: RegExp, addCount: (n: number) => void): string {
    let count = 0;
    const out = s.replace(pattern, () => {
        count++;
        return '';
    });
    if (count > 0) addCount(count);
    return out;
}

/**
 * Removes every match of `startPattern` together with its matching parenthesized
 * block (balanced parens, including nested). The pattern must end with `(` so the
 * opening paren of the block is the last character of the match.
 */
function stripBalancedBlocks(s: string, startPattern: RegExp): { s: string; removed: number } {
    let result = '';
    let lastEnd = 0;
    let removed = 0;
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
        removed++;
    }
    result += s.slice(lastEnd);
    return { s: result, removed };
}

function countParenDelta(line: string): number {
    let delta = 0;
    for (const ch of line) {
        if (ch === '(') delta++;
        else if (ch === ')') delta--;
    }
    return delta;
}
