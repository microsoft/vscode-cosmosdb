/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Denque from 'denque';
import { type JSONSchema } from '../JSONSchema.js';
import { getTypeEntries } from './schemaVariants.js';

/**
 * Pure schema utility functions that work on any schema produced by the analyzers.
 * These do not depend on the type system (JSON vs BSON).
 */

// ── FieldEntry & getKnownFields ────────────────────────────────────────

export interface FieldEntry {
    /** Dot-notated path (e.g., "user.profile.name") */
    path: string;
    /** JSON Schema type of the dominant type entry ("string", "number", "object", "array", etc.) */
    type: string;
    /** Dominant data type from the type extension key (e.g., "date", "objectid", "int32" for BSON) */
    dataType: string;
    /** All observed data types for this field (for polymorphic fields) */
    dataTypes?: string[];
    /**
     * True if this field was not present in every inspected document
     * (x-occurrence < parent x-documentsInspected).
     */
    isSparse?: boolean;
    /** If the field is an array, the dominant element data type */
    arrayItemDataType?: string;
}

/**
 * Traverses the JSON Schema and collects all leaf property paths
 * along with their most common data types (breadth-first).
 *
 * @param schema - The schema to traverse
 * @param typeExtensionKey - The x- key that stores the original data type
 *                           (e.g., `'x-bsonType'` or `'x-dataType'`)
 */
export function getKnownFields(schema: JSONSchema, typeExtensionKey: string): FieldEntry[] {
    const result: FieldEntry[] = [];

    type QueueItem = {
        path: string;
        schemaNode: JSONSchema;
        parentDocumentsInspected: number;
    };

    const rootDocumentsInspected = (schema['x-documentsInspected'] as number) ?? 0;
    const queue: Denque<QueueItem> = new Denque();

    if (schema.properties) {
        for (const propName of Object.keys(schema.properties)) {
            const propSchema = schema.properties[propName] as JSONSchema;
            queue.push({
                path: propName,
                schemaNode: propSchema,
                parentDocumentsInspected: rootDocumentsInspected,
            });
        }
    }

    while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;

        const { path, schemaNode, parentDocumentsInspected } = item;
        const mostCommonTypeEntry = getMostCommonTypeEntry(schemaNode);

        if (mostCommonTypeEntry) {
            if (mostCommonTypeEntry.type === 'object' && mostCommonTypeEntry.properties) {
                const objectDocumentsInspected = (mostCommonTypeEntry['x-documentsInspected'] as number) ?? 0;
                for (const childName of Object.keys(mostCommonTypeEntry.properties)) {
                    const childSchema = mostCommonTypeEntry.properties[childName] as JSONSchema;
                    queue.push({
                        path: `${path}.${childName}`,
                        schemaNode: childSchema,
                        parentDocumentsInspected: objectDocumentsInspected,
                    });
                }
            } else {
                const dataType =
                    ((mostCommonTypeEntry as Record<string, unknown>)[typeExtensionKey] as string) ??
                    (mostCommonTypeEntry.type as string);

                const entry: FieldEntry = {
                    path,
                    type: mostCommonTypeEntry.type as string,
                    dataType,
                };

                const allDataTypes = collectDataTypes(schemaNode, typeExtensionKey);
                if (allDataTypes.length >= 2) {
                    entry.dataTypes = allDataTypes;
                }

                const occurrence = (schemaNode['x-occurrence'] as number) ?? 0;
                if (parentDocumentsInspected > 0 && occurrence < parentDocumentsInspected) {
                    entry.isSparse = true;
                }

                if (mostCommonTypeEntry.type === 'array') {
                    const itemDataType = getDominantArrayItemDataType(mostCommonTypeEntry, typeExtensionKey);
                    if (itemDataType) {
                        entry.arrayItemDataType = itemDataType;
                    }
                }

                result.push(entry);
            }
        }
    }

    result.sort((a, b) => {
        if (a.path === '_id') return -1;
        if (b.path === '_id') return 1;
        return a.path.localeCompare(b.path);
    });

    return result;
}

function getMostCommonTypeEntry(schemaNode: JSONSchema): JSONSchema | null {
    let maxOccurrence = -1;
    let mostCommonTypeEntry: JSONSchema | null = null;

    for (const typeEntry of getTypeEntries(schemaNode)) {
        const occurrence = typeEntry['x-typeOccurrence'] || 0;
        if (occurrence > maxOccurrence) {
            maxOccurrence = occurrence;
            mostCommonTypeEntry = typeEntry;
        }
    }
    return mostCommonTypeEntry;
}

function collectDataTypes(schemaNode: JSONSchema, typeExtensionKey: string): string[] {
    const types = new Set<string>();
    for (const entry of getTypeEntries(schemaNode)) {
        const dt = (entry as Record<string, unknown>)[typeExtensionKey] as string | undefined;
        if (dt) {
            types.add(dt);
        }
    }

    return Array.from(types).sort();
}

function getDominantArrayItemDataType(arrayTypeEntry: JSONSchema, typeExtensionKey: string): string | undefined {
    const itemsSchema = arrayTypeEntry.items as JSONSchema | undefined;
    const entry = itemsSchema && getMostCommonTypeEntry(itemsSchema);
    return entry ? ((entry as Record<string, unknown>)[typeExtensionKey] as string | undefined) : undefined;
}

// ── simplifySchema ─────────────────────────────────────────────────────

/**
 * Simplifies the schema by unwrapping `anyOf` arrays that contain only a single type entry.
 * When a node's `anyOf` has exactly one element, that element's fields are merged directly
 * into the parent node and the `anyOf` wrapper is removed. Applied recursively to the
 * entire schema tree (nested `properties` and `items` are also simplified).
 */
export function simplifySchema(schema: JSONSchema): void {
    if (!schema.properties) return;

    for (const propSchema of Object.values(schema.properties)) {
        simplifySchemaNode(propSchema as JSONSchema);
    }
}

function simplifySchemaNode(node: JSONSchema): void {
    if (node.anyOf && (node.anyOf as JSONSchema[]).length === 1) {
        const single = (node.anyOf as JSONSchema[])[0];
        for (const [k, v] of Object.entries(single)) {
            (node as Record<string, unknown>)[k] = v;
        }
        delete node.anyOf;
    }

    if (node.anyOf) {
        for (const entry of node.anyOf as JSONSchema[]) {
            simplifySchemaNode(entry);
        }
    }

    if (node.properties) {
        for (const propSchema of Object.values(node.properties)) {
            simplifySchemaNode(propSchema as JSONSchema);
        }
    }

    if (node.items) {
        simplifySchemaNode(node.items as JSONSchema);
    }
}

// ── getSchemaAtPath ────────────────────────────────────────────────────

/**
 * Returns the first object matching the complete path. At each segment, objects reached through fewer
 * array levels take priority across all parent variants; equally deep matches retain traversal order.
 * A terminal field with no object variant returns undefined; a missing path segment throws.
 */
export function getSchemaAtPath(schema: JSONSchema, path: string[]): JSONSchema | undefined {
    return getObjectSchemasAtPath(schema, path)[0];
}

/**
 * Paths name properties, not array indexes. Keep all reachable object variants until the entire path
 * has been resolved; a later segment may exist only in an array's object items.
 */
function getObjectSchemasAtPath(schema: JSONSchema, path: string[]): JSONSchema[] {
    let currentNodes = [schema];

    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        const propertySchemas: JSONSchema[] = [];

        for (const currentNode of currentNodes) {
            if (currentNode.properties && Object.hasOwn(currentNode.properties, key)) {
                propertySchemas.push(currentNode.properties[key] as JSONSchema);
            }
        }
        if (propertySchemas.length === 0) {
            throw new Error(`No properties found in the schema at path "${path.slice(0, i + 1).join('/')}"`);
        }
        currentNodes = getObjectVariants(propertySchemas);
    }

    return currentNodes;
}

function getObjectVariants(schemas: JSONSchema[]): JSONSchema[] {
    const objects: JSONSchema[] = [];
    const queue = new Denque<JSONSchema>(schemas);
    while (queue.length > 0) {
        const node = queue.shift();
        if (!node) continue;
        for (const entry of getTypeEntries(node)) {
            if (entry.type === 'object') {
                objects.push(entry);
            } else if (entry.type === 'array' && entry.items) {
                queue.push(entry.items as JSONSchema);
            }
        }
    }
    return objects;
}

// ── getPropertyNamesAtLevel ────────────────────────────────────────────

/** Lists the union of property names across object variants reachable at the requested path. */
export function getPropertyNamesAtLevel(jsonSchema: JSONSchema, path: string[]): string[] {
    const headers = new Set<string>();

    for (const selectedSchema of getObjectSchemasAtPath(jsonSchema, path)) {
        if (selectedSchema.properties) {
            for (const key of Object.keys(selectedSchema.properties)) {
                headers.add(key);
            }
        }
    }

    return Array.from(headers).sort((a, b) => {
        if (a === '_id') return -1;
        if (b === '_id') return 1;
        return a.localeCompare(b);
    });
}

// ── buildFullPaths ─────────────────────────────────────────────────────

export function buildFullPaths(path: string[], propertyNames: string[]): string[] {
    return propertyNames.map((name) => path.concat(name).join('.'));
}
