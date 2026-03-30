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
import { NOSQL_KEYWORD_TOKENS } from './nosqlLanguageDefinitions';

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
    // Match: FROM <source> AS <alias> or FROM <source> <alias>
    const fromAsMatch = text.match(/\bFROM\s+\w+\s+(?:AS\s+)?(\w+)/i);
    if (fromAsMatch) {
        // Make sure we didn't match a keyword
        const candidate = fromAsMatch[1].toUpperCase();
        const keywords = new Set(NOSQL_KEYWORD_TOKENS.map((k) => k.toUpperCase()));
        if (!keywords.has(candidate)) {
            return fromAsMatch[1];
        }
    }
    // Fallback: just the first word after FROM
    const fromMatch = text.match(/\bFROM\s+(\w+)/i);
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
    const aliases: JoinAlias[] = [];
    const joinRegex = /\bJOIN\s+(\w+)\s+IN\s+(\w+(?:\.\w+)*)/gi;
    let match: RegExpExecArray | null;
    while ((match = joinRegex.exec(text)) !== null) {
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
