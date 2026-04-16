/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parser utilities for CosmosDB NoSQL query language.
 *
 * This module provides functions for parsing and analyzing NoSQL queries:
 * - Alias extraction (FROM and JOIN clauses)
 * - Schema property resolution for autocompletion
 * - Snippet generation from function signatures
 * - Type label and occurrence helpers
 *
 * It is environment-agnostic — it imports neither `vscode` nor `monaco-editor`.
 */

import { type JSONSchema } from '../../utils/json/JSONSchema';
import {
    type ClauseType,
    type KeywordInfo,
    NOSQL_AGGREGATE_FUNCTION_NAMES,
    NOSQL_FUNCTIONS,
    NOSQL_KEYWORD_TOKENS,
} from './nosqlLanguageDefinitions';

// ─── Query Block Splitting ─────────────────────────────────────────────────────

/**
 * Splits the full editor text into query blocks delimited by `;` and returns
 * the text of the query block that contains the cursor.
 *
 * Semicolons inside string literals (single or double quoted) and comments
 * (`--` line comments and `/* ... * /` block comments) are ignored.
 *
 * @param fullText - The entire editor content.
 * @param cursorOffset - Zero-based character offset of the cursor within `fullText`.
 * @returns The text of the query block containing the cursor.
 */
export function getCurrentQueryBlock(fullText: string, cursorOffset: number): string {
    const boundaries = findQueryBlockBoundaries(fullText);

    let blockStart = 0;
    for (const boundary of boundaries) {
        if (boundary >= cursorOffset) {
            break;
        }
        blockStart = boundary + 1;
    }

    // Find end of block: next boundary at or after cursor, or end of text
    let blockEnd = fullText.length;
    for (const boundary of boundaries) {
        if (boundary >= cursorOffset) {
            blockEnd = boundary;
            break;
        }
    }

    return fullText.substring(blockStart, blockEnd);
}

/**
 * Finds the positions of all `;` characters that serve as query separators
 * (not inside strings or comments).
 */
function findQueryBlockBoundaries(text: string): number[] {
    const boundaries: number[] = [];
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        // Single-quoted string
        if (ch === "'") {
            i++;
            while (i < text.length) {
                if (text[i] === "'" && text[i + 1] === "'") {
                    i += 2; // SQL-style escaped quote
                } else if (text[i] === '\\') {
                    i += 2; // backslash escape
                } else if (text[i] === "'") {
                    i++;
                    break;
                } else {
                    i++;
                }
            }
            continue;
        }

        // Double-quoted string
        if (ch === '"') {
            i++;
            while (i < text.length) {
                if (text[i] === '\\') {
                    i += 2;
                } else if (text[i] === '"') {
                    i++;
                    break;
                } else {
                    i++;
                }
            }
            continue;
        }

        // Line comment: --
        if (ch === '-' && text[i + 1] === '-') {
            i += 2;
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            continue;
        }

        // Block comment: /* ... */
        if (ch === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length) {
                if (text[i] === '*' && text[i + 1] === '/') {
                    i += 2;
                    break;
                }
                i++;
            }
            continue;
        }

        // Semicolon separator
        if (ch === ';') {
            boundaries.push(i);
        }

        i++;
    }

    return boundaries;
}

// ─── Clause Context Detection ──────────────────────────────────────────────────

// Re-export ClauseType for consumers that already import it from here
export type { ClauseType } from './nosqlLanguageDefinitions';

/**
 * Sub-positions within a clause that affect what completions are valid.
 * - `initial` — directly after the clause keyword, nothing typed yet
 * - `post-expression` — after a value/expression (e.g. after `ORDER BY c.name`)
 * - `post-star` — after `SELECT *`
 * - `post-alias` — after `FROM c` (where next clauses like JOIN/WHERE are valid)
 */
export type SubPosition = 'initial' | 'post-expression' | 'post-star' | 'post-alias';

/** Structured result describing where the cursor sits within a query. */
export interface ClauseContext {
    /** Which clause the cursor is currently inside. */
    clause: ClauseType;
    /** Fine-grained position within the clause. */
    subPosition: SubPosition;
    /** Whether the query contains a GROUP BY clause (affects SELECT suggestions). */
    hasGroupBy: boolean;
    /** The preceding non-whitespace token before the cursor (lowercase), if any. */
    precedingToken: string | null;
}

/**
 * Clause keywords ordered from longest to shortest so multi-word keywords
 * match first (e.g. "ORDER BY RANK" before "ORDER BY" before "ORDER").
 */
const CLAUSE_PATTERNS: { pattern: RegExp; clause: ClauseType }[] = [
    { pattern: /ORDER\s+BY\s+RANK/i, clause: 'orderby' },
    { pattern: /ORDER\s+BY/i, clause: 'orderby' },
    { pattern: /GROUP\s+BY/i, clause: 'groupby' },
    { pattern: /SELECT/i, clause: 'select' },
    { pattern: /FROM/i, clause: 'from' },
    { pattern: /WHERE/i, clause: 'where' },
    { pattern: /JOIN/i, clause: 'join' },
    { pattern: /OFFSET/i, clause: 'offset' },
    { pattern: /LIMIT/i, clause: 'limit' },
];

/**
 * Detects which clause the cursor is within by scanning the text before the cursor.
 *
 * The function strips string literals and comments, then finds the last top-level
 * clause keyword (not inside parentheses). It also determines a sub-position
 * within the clause based on what tokens follow the clause keyword.
 *
 * @param queryBlockText - The isolated query block text (already split by `;`).
 * @param cursorOffsetInBlock - Zero-based cursor offset within the query block.
 * @returns A `ClauseContext` describing the cursor position.
 */
export function detectClauseContext(queryBlockText: string, cursorOffsetInBlock: number): ClauseContext {
    const textBeforeCursor = queryBlockText.substring(0, cursorOffsetInBlock);

    // Check for GROUP BY anywhere in the full query block (not just before cursor)
    const hasGroupBy = /\bGROUP\s+BY\b/i.test(stripStringsAndComments(queryBlockText));

    // Strip string literals and comments to avoid matching keywords inside them
    const stripped = stripStringsAndComments(textBeforeCursor);

    // Find the last top-level clause keyword (outside parentheses)
    let lastClause: ClauseType = 'none';
    let lastClauseEndIndex = -1;

    for (const { pattern, clause } of CLAUSE_PATTERNS) {
        // Find all matches of this pattern in the stripped text
        const globalPattern = new RegExp(pattern.source, 'gi');
        let match: RegExpExecArray | null;
        while ((match = globalPattern.exec(stripped)) !== null) {
            const matchEnd = match.index + match[0].length;
            // Only consider if this match is at top-level (not inside parentheses)
            if (isTopLevel(stripped, match.index) && matchEnd > lastClauseEndIndex) {
                lastClause = clause;
                lastClauseEndIndex = matchEnd;
            }
        }
    }

    // Determine sub-position based on text after the clause keyword
    const textAfterClause = stripped.substring(lastClauseEndIndex).trim();
    const subPosition = determineSubPosition(lastClause, textAfterClause);

    // Get the preceding token (last non-whitespace word/symbol before cursor)
    const precedingToken = extractPrecedingToken(stripped);

    return {
        clause: lastClause,
        subPosition,
        hasGroupBy,
        precedingToken,
    };
}

/**
 * Determines whether the position is at top-level (parenthesis depth 0).
 */
function isTopLevel(text: string, position: number): boolean {
    let depth = 0;
    for (let i = 0; i < position; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth = Math.max(0, depth - 1);
    }
    return depth === 0;
}

/**
 * Determines the sub-position within a clause based on what follows the clause keyword.
 */
function determineSubPosition(clause: ClauseType, textAfterClause: string): SubPosition {
    if (!textAfterClause) {
        return 'initial';
    }

    switch (clause) {
        case 'select':
            if (/^\*/.test(textAfterClause)) return 'post-star';
            if (textAfterClause.length > 0) return 'post-expression';
            return 'initial';

        case 'from':
            // After FROM <alias>, the user is in post-alias position
            if (/^\w+/.test(textAfterClause)) return 'post-alias';
            return 'initial';

        case 'orderby':
            // After ORDER BY <expr>, check if there's an expression
            if (textAfterClause.length > 0) return 'post-expression';
            return 'initial';

        case 'groupby':
            if (textAfterClause.length > 0) return 'post-expression';
            return 'initial';

        default:
            if (textAfterClause.length > 0) return 'post-expression';
            return 'initial';
    }
}

/**
 * Extracts the preceding token (last meaningful word or symbol) from the stripped text.
 */
function extractPrecedingToken(stripped: string): string | null {
    const match = stripped.match(/(\w+|[^\s])\s*$/);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Strips string literals and comments from query text, replacing them with spaces
 * to preserve character positions. This prevents matching keywords inside strings/comments.
 */
function stripStringsAndComments(text: string): string {
    const chars = [...text];
    let i = 0;

    while (i < chars.length) {
        // Single-quoted string
        if (chars[i] === "'") {
            chars[i] = ' ';
            i++;
            while (i < chars.length) {
                if (chars[i] === "'" && chars[i + 1] === "'") {
                    chars[i] = ' ';
                    chars[i + 1] = ' ';
                    i += 2;
                } else if (chars[i] === '\\') {
                    chars[i] = ' ';
                    if (i + 1 < chars.length) chars[i + 1] = ' ';
                    i += 2;
                } else if (chars[i] === "'") {
                    chars[i] = ' ';
                    i++;
                    break;
                } else {
                    chars[i] = ' ';
                    i++;
                }
            }
            continue;
        }

        // Double-quoted string
        if (chars[i] === '"') {
            chars[i] = ' ';
            i++;
            while (i < chars.length) {
                if (chars[i] === '\\') {
                    chars[i] = ' ';
                    if (i + 1 < chars.length) chars[i + 1] = ' ';
                    i += 2;
                } else if (chars[i] === '"') {
                    chars[i] = ' ';
                    i++;
                    break;
                } else {
                    chars[i] = ' ';
                    i++;
                }
            }
            continue;
        }

        // Line comment: --
        if (chars[i] === '-' && chars[i + 1] === '-') {
            while (i < chars.length && chars[i] !== '\n') {
                chars[i] = ' ';
                i++;
            }
            continue;
        }

        // Block comment: /* ... */
        if (chars[i] === '/' && chars[i + 1] === '*') {
            chars[i] = ' ';
            chars[i + 1] = ' ';
            i += 2;
            while (i < chars.length) {
                if (chars[i] === '*' && chars[i + 1] === '/') {
                    chars[i] = ' ';
                    chars[i + 1] = ' ';
                    i += 2;
                    break;
                }
                chars[i] = ' ';
                i++;
            }
            continue;
        }

        i++;
    }

    return chars.join('');
}

// ─── Alias Extraction ──────────────────────────────────────────────────────────

/**
 * Extracts the alias used in the FROM clause. For example:
 *   "SELECT * FROM c"          → "c"
 *   "SELECT * FROM container"  → "container"
 *   "SELECT * FROM c AS doc"   → "doc"
 *   "SELECT * FROM container c" → "c"
 *
 * Falls back to "c" which is the most common convention.
 */
export function extractFromAlias(text: string): string {
    // Strip comments and strings to avoid matching keywords inside them
    const stripped = stripStringsAndComments(text);

    // Match: FROM <source> AS <alias> or FROM <source> <alias>
    const fromAsMatch = stripped.match(/\bFROM\s+\w+\s+(?:AS\s+)?(\w+)/i);
    if (fromAsMatch) {
        // Make sure we didn't match a keyword
        const candidate = fromAsMatch[1].toUpperCase();
        const keywords = new Set(NOSQL_KEYWORD_TOKENS.map((k) => k.toUpperCase()));
        if (!keywords.has(candidate)) {
            return fromAsMatch[1];
        }
    }
    // Fallback: just the first word after FROM
    const fromMatch = stripped.match(/\bFROM\s+(\w+)/i);
    return fromMatch?.[1] ?? 'c';
}

/**
 * Represents a JOIN alias and the schema path it references.
 * For `JOIN s IN p.sizes`, alias = "s", sourceAlias = "p", propertyPath = ["sizes"]
 */
export interface JoinAlias {
    alias: string;
    sourceAlias: string;
    propertyPath: string[];
}

/**
 * Extracts all JOIN aliases from the query text.
 * Parses patterns like:
 *   `JOIN s IN p.sizes`           → { alias: "s", sourceAlias: "p", propertyPath: ["sizes"] }
 *   `JOIN c IN p.nested.colors`   → { alias: "c", sourceAlias: "p", propertyPath: ["nested", "colors"] }
 */
export function extractJoinAliases(text: string): JoinAlias[] {
    // Strip comments and strings to avoid matching keywords inside them
    const stripped = stripStringsAndComments(text);

    const aliases: JoinAlias[] = [];
    const joinRegex = /\bJOIN\s+(\w+)\s+IN\s+(\w+(?:\.\w+)*)/gi;
    let match: RegExpExecArray | null;
    while ((match = joinRegex.exec(stripped)) !== null) {
        const alias = match[1] as string;
        const fullPath = match[2] as string;
        const segments: string[] = fullPath.split('.');
        aliases.push({
            alias,
            sourceAlias: segments[0] as string,
            propertyPath: segments.slice(1),
        });
    }
    return aliases;
}

// ─── Schema Resolution ─────────────────────────────────────────────────────────

/**
 * Resolves the schema for a JOIN alias by traversing the property path
 * and then descending into the array `items` schema.
 *
 * For `JOIN s IN p.sizes` where sizes is an array of objects,
 * this returns the properties of the array item (not the array itself).
 */
export function resolveJoinAliasSchema(
    schema: JSONSchema,
    joinAlias: JoinAlias,
    fromAlias: string,
    allJoinAliases: JoinAlias[],
): JSONSchema | undefined {
    // Build the full path by resolving the source alias chain
    const fullPath = resolveAliasToPath(joinAlias.sourceAlias, fromAlias, allJoinAliases);
    if (!fullPath) return undefined;

    const completePath = [...fullPath, ...joinAlias.propertyPath];

    // Navigate to the property
    let current: JSONSchema = schema;
    for (const segment of completePath) {
        // If current is an array, descend into items first (intermediate array traversal)
        if (current.type === 'array' && current.items) {
            const items = current.items as JSONSchema;
            if (items.properties) {
                current = items;
            } else if (items.anyOf) {
                const objectItem = (items.anyOf as JSONSchema[]).find(
                    (entry) => entry.type === 'object' || entry.properties,
                );
                if (objectItem) {
                    current = objectItem;
                } else {
                    return undefined;
                }
            } else {
                return undefined;
            }
        }

        if (!current.properties) return undefined;
        const prop = (current.properties as unknown as Record<string, JSONSchema>)[segment];
        if (!prop) return undefined;

        if (prop.properties) {
            current = prop;
        } else if (prop.anyOf) {
            const objectEntry = (prop.anyOf as JSONSchema[]).find(
                (entry) => entry.type === 'object' || entry.properties,
            );
            if (objectEntry) {
                current = objectEntry;
            } else {
                // Try to find an array entry
                const arrayEntry = (prop.anyOf as JSONSchema[]).find((entry) => entry.type === 'array');
                if (arrayEntry) {
                    current = arrayEntry;
                } else {
                    return undefined;
                }
            }
        } else {
            current = prop;
        }
    }

    // Now descend into array items — JOIN iterates over array elements
    if (current.type === 'array' && current.items) {
        const items = current.items as JSONSchema;
        // Items may have anyOf with an object entry
        if (items.properties) {
            return items;
        }
        if (items.anyOf) {
            const objectItem = (items.anyOf as JSONSchema[]).find(
                (entry) => entry.type === 'object' || entry.properties,
            );
            if (objectItem) return objectItem;
        }
        return items;
    }

    // If the property itself is the array items schema (already resolved)
    return current;
}

/**
 * Resolves an alias back to its property path relative to the root schema.
 * Handles chained JOINs, e.g. if `s` is from `JOIN s IN p.sizes` and `p` is the FROM alias,
 * returns ["sizes"].
 */
function resolveAliasToPath(
    alias: string,
    fromAlias: string,
    allJoinAliases: JoinAlias[],
    visited: Set<string> = new Set(),
): string[] | undefined {
    if (alias.toLowerCase() === fromAlias.toLowerCase()) {
        return []; // FROM alias maps to root
    }

    if (visited.has(alias)) return undefined; // prevent infinite loops
    visited.add(alias);

    // Find the JOIN that defines this alias
    const joinDef = allJoinAliases.find((j) => j.alias.toLowerCase() === alias.toLowerCase());
    if (!joinDef) return undefined;

    const parentPath = resolveAliasToPath(joinDef.sourceAlias, fromAlias, allJoinAliases, visited);
    if (!parentPath) return undefined;

    return [...parentPath, ...joinDef.propertyPath];
}

/**
 * Resolves the property path typed after an alias and returns matching schema properties.
 * For example, with schema { properties: { address: { properties: { city: ... } } } }:
 *   path = ["address"] → returns the properties of `address`
 *   path = []          → returns the root-level properties
 */
export function resolveSchemaProperties(schema: JSONSchema, path: string[]): Record<string, JSONSchema> | undefined {
    let current: JSONSchema = schema;

    for (const segment of path) {
        if (!current.properties) {
            return undefined;
        }

        const prop = (current.properties as unknown as Record<string, JSONSchema>)[segment];
        if (!prop) {
            return undefined;
        }

        // Traverse into the property — it may have its own properties (object type)
        // or it may have anyOf with an entry that has properties
        if (prop.properties) {
            current = prop;
        } else if (prop.anyOf) {
            const objectEntry = (prop.anyOf as JSONSchema[]).find(
                (entry) => entry.type === 'object' || entry.properties,
            );
            if (objectEntry) {
                current = objectEntry;
            } else {
                return undefined;
            }
        } else {
            return undefined;
        }
    }

    if (!current.properties) {
        return undefined;
    }

    return current.properties as unknown as Record<string, JSONSchema>;
}

// ─── Property Helpers ──────────────────────────────────────────────────────────

/**
 * Determines whether the given property name requires bracket notation.
 * Property names with special characters (spaces, dashes, dots, etc.) need `["..."]` syntax.
 */
export function needsBracketNotation(name: string): boolean {
    return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

/**
 * Gets a human-readable type label from a schema property.
 */
export function getTypeLabel(propSchema: JSONSchema): string {
    if (propSchema.type) {
        return Array.isArray(propSchema.type) ? propSchema.type.join(' | ') : propSchema.type;
    }

    if (propSchema.anyOf) {
        const types = (propSchema.anyOf as JSONSchema[])
            .map((entry) => entry.type ?? entry['x-bsonType'] ?? 'unknown')
            .filter(Boolean);
        return types.join(' | ');
    }

    return 'unknown';
}

/**
 * Gets the occurrence count for a schema property.
 * Uses `x-occurrence` which tracks how many documents contain this property.
 * Higher values mean the property is more common and should rank higher in completions.
 */
export function getOccurrence(propSchema: JSONSchema): number {
    return (propSchema['x-occurrence'] as number) ?? 0;
}

/**
 * Resolves the schema for a specific property referenced by a dot-path expression.
 *
 * Given `c.address.city` (with FROM alias `c`), returns the JSONSchema for `city`.
 * Handles JOIN aliases as the root too (e.g. `s.color` where `s` is a JOIN alias).
 *
 * @param schema        - Root container schema
 * @param dotPath       - Full dot-path string e.g. "c.address.city"
 * @param fromAlias     - The alias from the FROM clause
 * @param joinAliases   - All JOIN aliases in the query
 * @returns `{ propSchema, propertyName }` or `undefined` if the path cannot be resolved
 */
export function resolvePropertyAtPath(
    schema: JSONSchema,
    dotPath: string,
    fromAlias: string,
    joinAliases: JoinAlias[],
): { propSchema: JSONSchema; propertyName: string } | undefined {
    const segments = dotPath.split('.');
    if (segments.length < 2) return undefined;

    const rootAlias = segments[0] as string;
    const propertySegments = segments.slice(1);
    const propertyName = propertySegments[propertySegments.length - 1] as string;
    const parentPath = propertySegments.slice(0, -1);

    // Resolve the base schema depending on whether root is the FROM alias or a JOIN alias
    let baseSchema: JSONSchema;
    if (rootAlias.toLowerCase() === fromAlias.toLowerCase()) {
        baseSchema = schema;
    } else {
        const joinDef = joinAliases.find((j) => j.alias.toLowerCase() === rootAlias.toLowerCase());
        if (!joinDef) return undefined;
        const joinSchema = resolveJoinAliasSchema(schema, joinDef, fromAlias, joinAliases);
        if (!joinSchema) return undefined;
        baseSchema = joinSchema;
    }

    // Navigate to the parent object's properties
    const parentProperties =
        parentPath.length === 0
            ? (baseSchema.properties as unknown as Record<string, JSONSchema> | undefined)
            : resolveSchemaProperties(baseSchema, parentPath);

    if (!parentProperties) return undefined;

    const propSchema = parentProperties[propertyName];
    if (!propSchema) return undefined;

    return { propSchema, propertyName };
}

// ─── Clause-Aware Suggestion Ranking ────────────────────────────────────────────

/**
 * Checks whether a keyword is relevant in the given clause context.
 * A keyword is relevant if its `validAfter` array includes the current clause.
 */
export function isKeywordRelevant(keyword: KeywordInfo, ctx: ClauseContext): boolean {
    if (!keyword.validAfter || keyword.validAfter.length === 0) {
        return true; // No filtering — always relevant
    }
    return keyword.validAfter.includes(ctx.clause);
}

/**
 * Computes the sort key prefix for a keyword based on clause context.
 *
 * Sort key scheme:
 * - `1_` — keyword is relevant in the current clause context
 * - `5_` — keyword is NOT relevant (pushed to bottom, but still visible)
 */
export function computeKeywordSortKey(keyword: KeywordInfo, ctx: ClauseContext): string {
    const relevant = isKeywordRelevant(keyword, ctx);
    const prefix = relevant ? '1' : '5';
    return `${prefix}_${keyword.name}`;
}

/**
 * Computes the sort key prefix for a function based on clause context.
 *
 * Sort key scheme:
 * - `1_` — aggregate function boosted in SELECT when GROUP BY is present
 * - `2_` — function is relevant (in clause that accepts expressions)
 * - `6_` — function is NOT relevant
 */
export function computeFunctionSortKey(funcName: string, ctx: ClauseContext): string {
    // Aggregate functions get top priority in SELECT when GROUP BY is present
    if (ctx.hasGroupBy && ctx.clause === 'select' && NOSQL_AGGREGATE_FUNCTION_NAMES.has(funcName)) {
        return `1_${funcName}`;
    }

    // Functions are relevant in expression positions: select, where, orderby, groupby, join
    const expressionClauses: ClauseType[] = ['select', 'where', 'orderby', 'groupby', 'join'];
    const relevant = expressionClauses.includes(ctx.clause);
    const prefix = relevant ? '2' : '6';
    return `${prefix}_${funcName}`;
}

/**
 * Computes the sort key for an alias based on clause context.
 *
 * Aliases are highly relevant in most clauses except FROM (initial) and NONE.
 * - `0_` — alias is the top suggestion (in SELECT, WHERE, ORDER BY, GROUP BY, etc.)
 * - `4_` — alias is less relevant (in FROM initial, NONE, etc.)
 */
export function computeAliasSortKey(aliasName: string, ctx: ClauseContext): string {
    const aliasClauses: ClauseType[] = ['select', 'where', 'orderby', 'groupby', 'join'];
    const relevant = aliasClauses.includes(ctx.clause);
    const prefix = relevant ? '0' : '4';
    return `${prefix}_${aliasName}`;
}

// ─── Function Argument Context Detection ────────────────────────────────────────

/**
 * Describes the function argument context when the cursor is inside a function call.
 */
export interface FunctionArgContext {
    /** The name of the innermost function (uppercase). */
    functionName: string;
    /** Zero-based index of the argument the cursor is in. */
    argIndex: number;
}

/**
 * Detects whether the cursor is inside a function call's arguments.
 *
 * Scans backward from the cursor through the stripped text (no strings/comments),
 * counting unmatched `(` and tracking `,` at the same parenthesis depth to
 * determine which argument position the cursor is at.
 *
 * Handles nested function calls: `LOWER(SUBSTRING(|))` → detects `SUBSTRING` at argIndex 0.
 *
 * @param queryBlockText - The isolated query block text.
 * @param cursorOffsetInBlock - Zero-based cursor offset within the query block.
 * @returns `FunctionArgContext` if inside a function call, or `null` otherwise.
 */
export function detectFunctionArgContext(
    queryBlockText: string,
    cursorOffsetInBlock: number,
): FunctionArgContext | null {
    const textBeforeCursor = queryBlockText.substring(0, cursorOffsetInBlock);
    const stripped = stripStringsAndComments(textBeforeCursor);

    // Walk backward to find the innermost unmatched `(`
    let depth = 0;
    let argIndex = 0;

    for (let i = stripped.length - 1; i >= 0; i--) {
        const ch = stripped[i];

        if (ch === ')') {
            depth++;
        } else if (ch === '(') {
            if (depth === 0) {
                // Found the unmatched `(` — now look backward for the function name
                const textBefore = stripped.substring(0, i).trimEnd();
                const funcNameMatch = textBefore.match(/(\w+)\s*$/);
                if (funcNameMatch) {
                    const candidateName = funcNameMatch[1].toUpperCase();
                    // Verify it's a known function (not a keyword like WHERE/SELECT)
                    const isFunction = NOSQL_FUNCTIONS.some((f) => f.name === candidateName);
                    if (isFunction) {
                        return {
                            functionName: candidateName,
                            argIndex,
                        };
                    }
                }
                // Not a recognized function — not inside a function call
                return null;
            }
            depth--;
        } else if (ch === ',' && depth === 0) {
            argIndex++;
        }
    }

    return null;
}

/**
 * Looks up the expected argument type(s) for a given function name and argument index.
 *
 * @param functionName - Uppercase function name (e.g. "CONTAINS").
 * @param argIndex - Zero-based argument index.
 * @returns The expected type string (e.g. "string", "number", "any") or `null` if unknown.
 */
export function getExpectedArgType(functionName: string, argIndex: number): string | null {
    const funcDef = NOSQL_FUNCTIONS.find((f) => f.name === functionName.toUpperCase());
    if (!funcDef) return null;

    const argDef = funcDef.arguments[argIndex];
    if (!argDef) return null;

    return argDef.type;
}

// ─── Type-Match Scoring ─────────────────────────────────────────────────────────

/**
 * Type-match score tiers for property ranking inside function arguments.
 * Lower values = higher priority.
 */
export const TYPE_MATCH_EXACT = 0;
export const TYPE_MATCH_PARTIAL = 1;
export const TYPE_MATCH_NONE = 2;

/**
 * Computes a type-match score between a schema property and the expected argument type.
 *
 * - Exact match: property type is exactly the expected type → `TYPE_MATCH_EXACT` (0)
 * - Partial match: property has `anyOf` with at least one matching type → `TYPE_MATCH_PARTIAL` (1)
 * - No match: property type doesn't match at all → `TYPE_MATCH_NONE` (2)
 * - Expected type is "any": all properties get `TYPE_MATCH_EXACT` (0)
 *
 * @param propSchema - The JSON schema of the property.
 * @param expectedType - The expected type from the function argument definition.
 * @returns A numeric score (lower = better match).
 */
export function computeTypeMatchScore(propSchema: JSONSchema, expectedType: string): number {
    // "any" matches everything
    if (expectedType === 'any') {
        return TYPE_MATCH_EXACT;
    }

    // Direct type match
    if (propSchema.type) {
        const propType = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];
        if (propType.includes(expectedType)) {
            return TYPE_MATCH_EXACT;
        }
        // For object/array types, also check for nested types
        return TYPE_MATCH_NONE;
    }

    // anyOf — check if any variant matches
    if (propSchema.anyOf) {
        const types = (propSchema.anyOf as JSONSchema[]).map((entry) => entry.type).filter(Boolean);
        if (types.includes(expectedType)) {
            return TYPE_MATCH_PARTIAL;
        }
        return TYPE_MATCH_NONE;
    }

    return TYPE_MATCH_NONE;
}

/**
 * Computes a composite sort key for a schema property that considers:
 * 1. Type match score (primary) — properties matching the expected type rank higher
 * 2. Occurrence count (secondary) — more common properties rank higher within each tier
 *
 * Format: `{typeMatchScore}_{occurrenceKey}`
 * where typeMatchScore is 0/1/2 and occurrenceKey is a zero-padded inverse count.
 *
 * @param propSchema - The JSON schema of the property.
 * @param expectedType - The expected type from function arg context, or `null` if not in a function.
 * @returns A sort key string for lexicographic ordering.
 */
export function computePropertySortKey(propSchema: JSONSchema, expectedType: string | null): string {
    const occurrence = getOccurrence(propSchema);
    const occurrenceKey = String(1e9 - occurrence).padStart(10, '0');

    if (!expectedType) {
        // No function context — just sort by occurrence
        return occurrenceKey;
    }

    const typeScore = computeTypeMatchScore(propSchema, expectedType);
    return `${typeScore}_${occurrenceKey}`;
}

// ─── Snippet Generation ────────────────────────────────────────────────────────

/**
 * Converts a function signature into a Monaco/VS Code snippet string with tab stops.
 *
 * Examples:
 *   "AVG(expr)"                          → "AVG(${1:expr})"
 *   "CONTAINS(str, substr [, ignoreCase])" → "CONTAINS(${1:str}, ${2:substr})"
 *   "PI()"                               → "PI()"
 *   "LOG(expr [, base])"                 → "LOG(${1:expr})"
 *
 * Optional parameters (wrapped in `[...]`) are excluded from the snippet
 * so the user gets the minimal required call and can add optional args manually.
 */
export function signatureToSnippet(name: string, signature: string): string {
    // Extract the content inside parentheses
    const parenMatch = signature.match(/\(([^)]*)\)/);
    if (!parenMatch || !parenMatch[1].trim()) {
        return `${name}()$0`;
    }

    const argsStr = parenMatch[1];

    // Remove optional parameters (anything inside [...])
    const withoutOptional = argsStr.replace(/\s*\[[^]]*]/g, '');

    // Split by comma and clean up
    const params = withoutOptional
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    if (params.length === 0) {
        return `${name}()$0`;
    }

    // Build tab stops: ${1:param1}, ${2:param2}, ...
    const snippetParams = params.map((p, i) => `\${${i + 1}:${p}}`).join(', ');
    return `${name}(${snippetParams})$0`;
}
