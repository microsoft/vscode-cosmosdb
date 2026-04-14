/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Denque from 'denque';
import  { type JSONSchema7TypeName } from 'json-schema';
import { type JSONSchema } from '../JSONSchema.js';

/**
 * Adapter interface that abstracts the type system differences between
 * JSON (NoSQL) and BSON (MongoDB) analyzers.
 *
 * The generic BFS traversal delegates all type-specific decisions to this adapter.
 */
export interface TypeAdapter<TType extends string = string> {
    /** Infer the data type of a value. */
    inferType(value: unknown): TType;

    /** Convert a data type to a JSON Schema type string. */
    toJSONType(type: TType): string;

    /**
     * The JSON Schema extension key used to store the original data type.
     * - JSON analyzer: `'x-dataType'`
     * - BSON analyzer: `'x-bsonType'`
     */
    typeExtensionKey: string;

    /** Initialize statistics for the first occurrence of a value. */
    initializeStats(value: unknown, type: TType, entry: JSONSchema): void;

    /** Aggregate statistics for subsequent occurrences of a value. */
    aggregateStats(value: unknown, type: TType, entry: JSONSchema): void;

    /**
     * Whether to track `x-documentsInspected` on nested object type entries.
     * BSON enables this for accurate probability calculation in nested objects.
     * @default false
     */
    trackNestedObjectDocs?: boolean;
}

// ── Generic BFS traversal ──────────────────────────────────────────────

type WorkItem<TType extends string> = {
    fieldName: string;
    fieldType: TType;
    propertySchema: JSONSchema;
    fieldValue: unknown;
    pathSoFar: string;
};

/**
 * Incrementally updates a schema by analyzing a single document using BFS traversal.
 * All type-specific logic is delegated to the provided {@link TypeAdapter}.
 */
export function updateSchemaWithDocument<TType extends string>(
    schema: JSONSchema,
    document: Record<string, unknown>,
    adapter: TypeAdapter<TType>,
): void {
    if (!schema.properties) {
        schema.properties = {};
        schema['x-documentsInspected'] = 0;
    }

    schema['x-documentsInspected'] = (schema['x-documentsInspected'] ?? 0) + 1;

    const fifoQueue: Denque<WorkItem<TType>> = new Denque();

    // Push root-level fields into the queue
    for (const [name, value] of Object.entries(document)) {
        const typeEntry = ensureTypeEntry(schema, name, value, adapter);

        fifoQueue.push({
            fieldName: name,
            fieldType: (typeEntry as Record<string, unknown>)[adapter.typeExtensionKey] as TType,
            propertySchema: typeEntry,
            fieldValue: value,
            pathSoFar: name,
        });
    }

    // BFS
    while (fifoQueue.length > 0) {
        const item = fifoQueue.shift();
        if (item === undefined) continue;

        const jsonType = adapter.toJSONType(item.fieldType);

        switch (jsonType) {
            case 'object': {
                const objValue = item.fieldValue as Record<string, unknown>;
                const objKeysCount = Object.keys(objValue).length;

                updateMinMax(item.propertySchema, 'x-minProperties', 'x-maxProperties', objKeysCount);

                if (adapter.trackNestedObjectDocs) {
                    item.propertySchema['x-documentsInspected'] =
                        (item.propertySchema['x-documentsInspected'] ?? 0) + 1;
                }

                if (!item.propertySchema.properties) {
                    item.propertySchema.properties = {};
                }

                for (const [name, value] of Object.entries(objValue)) {
                    const typeEntry = ensureTypeEntry(item.propertySchema, name, value, adapter);

                    fifoQueue.push({
                        fieldName: name,
                        fieldType: (typeEntry as Record<string, unknown>)[adapter.typeExtensionKey] as TType,
                        propertySchema: typeEntry,
                        fieldValue: value,
                        pathSoFar: `${item.pathSoFar}.${name}`,
                    });
                }
                break;
            }

            case 'array': {
                const arrayValue = item.fieldValue as unknown[];
                const arrayLength = arrayValue.length;

                updateMinMax(item.propertySchema, 'x-minItems', 'x-maxItems', arrayLength);

                if (!item.propertySchema.items) {
                    item.propertySchema.items = { anyOf: [] };
                }

                const itemsSchema = item.propertySchema.items as JSONSchema;

                for (const element of arrayValue) {
                    const elementType = adapter.inferType(element);
                    const anyOfArray = (itemsSchema.anyOf ?? []) as JSONSchema[];
                    let itemEntry = findTypeEntry(anyOfArray, elementType, adapter.typeExtensionKey);
                    const isNew = !itemEntry;

                    if (!itemEntry) {
                        itemEntry = createTypeEntry(adapter.toJSONType(elementType), adapter.typeExtensionKey, elementType);
                        if (!itemsSchema.anyOf) {
                            itemsSchema.anyOf = [];
                        }
                        (itemsSchema.anyOf as JSONSchema[]).push(itemEntry);
                    }

                    itemEntry['x-typeOccurrence'] = (itemEntry['x-typeOccurrence'] ?? 0) + 1;

                    if (isNew) {
                        adapter.initializeStats(element, elementType, itemEntry);
                    } else {
                        adapter.aggregateStats(element, elementType, itemEntry);
                    }

                    const elementJsonType = adapter.toJSONType(elementType);
                    if (elementJsonType === 'object' || elementJsonType === 'array') {
                        fifoQueue.push({
                            fieldName: '[]',
                            fieldType: elementType,
                            propertySchema: itemEntry,
                            fieldValue: element,
                            pathSoFar: `${item.pathSoFar}[]`,
                        });
                    }
                }
                break;
            }

            default: {
                if (item.propertySchema['x-typeOccurrence'] === 1) {
                    adapter.initializeStats(item.fieldValue, item.fieldType, item.propertySchema);
                } else {
                    adapter.aggregateStats(item.fieldValue, item.fieldType, item.propertySchema);
                }
                break;
            }
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────

function createTypeEntry(jsonType: string, extensionKey: string, dataType: string): JSONSchema {
    const entry: JSONSchema = {
        type: jsonType as JSONSchema7TypeName,
        'x-typeOccurrence': 0,
    };
    (entry as Record<string, unknown>)[extensionKey] = dataType;
    return entry;
}

/**
 * Ensures a property exists in the schema and returns the matching type entry
 * (creating one if needed). Also increments occurrence counters.
 */
function ensureTypeEntry<TType extends string>(
    parentSchema: JSONSchema,
    fieldName: string,
    fieldValue: unknown,
    adapter: TypeAdapter<TType>,
): JSONSchema {
    if (!parentSchema.properties![fieldName]) {
        parentSchema.properties![fieldName] = {
            anyOf: [],
            'x-occurrence': 0,
        } as JSONSchema;
    }

    const propertySchema = parentSchema.properties![fieldName] as JSONSchema;
    propertySchema['x-occurrence'] = (propertySchema['x-occurrence'] ?? 0) + 1;

    const datatype = adapter.inferType(fieldValue);
    const anyOfArray = (propertySchema.anyOf ?? []) as JSONSchema[];
    let typeEntry = findTypeEntry(anyOfArray, datatype, adapter.typeExtensionKey);

    if (!typeEntry) {
        typeEntry = createTypeEntry(adapter.toJSONType(datatype), adapter.typeExtensionKey, datatype);
        if (!propertySchema.anyOf) {
            propertySchema.anyOf = [];
        }
        (propertySchema.anyOf as JSONSchema[]).push(typeEntry);
    }

    typeEntry['x-typeOccurrence'] = (typeEntry['x-typeOccurrence'] ?? 0) + 1;

    return typeEntry;
}

function findTypeEntry(anyOfArray: JSONSchema[], dataType: string, extensionKey: string): JSONSchema | undefined {
    return anyOfArray.find((entry) => (entry as Record<string, unknown>)[extensionKey] === dataType);
}

function updateMinMax(schema: JSONSchema, minKey: string, maxKey: string, value: number): void {
    const record = schema as Record<string, unknown>;
    if (record[minKey] === undefined || value < (record[minKey] as number)) {
        record[minKey] = value;
    }
    if (record[maxKey] === undefined || value > (record[maxKey] as number)) {
        record[maxKey] = value;
    }
}
