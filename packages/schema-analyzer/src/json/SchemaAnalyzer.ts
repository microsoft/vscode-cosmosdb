/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema inference for plain JSON / CosmosDB NoSQL documents.
 *
 * Uses the shared core traversal with a JSON-specific type adapter.
 * Schema output uses `x-dataType` (not `x-bsonType`) for the original type tag.
 */

import { type JSONSchema } from '../JSONSchema.js';
import { type TypeAdapter, updateSchemaWithDocument as updateSchemaGeneric } from '../core/schemaTraversal.js';
import { simplifySchema } from '../core/schemaUtils.js';
import { type NoSQLTypes, inferNoSqlType, noSqlTypeToJSONType } from './NoSqlTypes.js';

export { buildFullPaths, getPropertyNamesAtLevel, simplifySchema } from '../core/schemaUtils.js';

export type NoSQLDocument = Record<string, unknown>;

// ── JSON Type Adapter ──────────────────────────────────────────────────

const jsonTypeAdapter: TypeAdapter<NoSQLTypes> = {
    inferType: inferNoSqlType,
    toJSONType: noSqlTypeToJSONType,
    typeExtensionKey: 'x-dataType',

    initializeStats(value: unknown, type: NoSQLTypes, entry: JSONSchema): void {
        switch (type) {
            case 'string': {
                const len = (value as string).length;
                entry['x-maxLength'] = len;
                entry['x-minLength'] = len;
                break;
            }
            case 'number': {
                const num = Number(value);
                entry['x-maxValue'] = num;
                entry['x-minValue'] = num;
                break;
            }
            case 'boolean': {
                const b = value as boolean;
                entry['x-trueCount'] = b ? 1 : 0;
                entry['x-falseCount'] = b ? 0 : 1;
                break;
            }
            default:
                break;
        }
    },

    aggregateStats(value: unknown, type: NoSQLTypes, entry: JSONSchema): void {
        switch (type) {
            case 'string': {
                const len = (value as string).length;
                if (entry['x-minLength'] === undefined || len < entry['x-minLength']) entry['x-minLength'] = len;
                if (entry['x-maxLength'] === undefined || len > entry['x-maxLength']) entry['x-maxLength'] = len;
                break;
            }
            case 'number': {
                const num = Number(value);
                if (entry['x-minValue'] === undefined || num < entry['x-minValue']) entry['x-minValue'] = num;
                if (entry['x-maxValue'] === undefined || num > entry['x-maxValue']) entry['x-maxValue'] = num;
                break;
            }
            case 'boolean': {
                const b = value as boolean;
                entry['x-trueCount'] = (entry['x-trueCount'] ?? 0) + (b ? 1 : 0);
                entry['x-falseCount'] = (entry['x-falseCount'] ?? 0) + (b ? 0 : 1);
                break;
            }
            default:
                break;
        }
    },
};

// ── Public API ─────────────────────────────────────────────────────────

export function updateSchemaWithDocument(schema: JSONSchema, document: NoSQLDocument): void {
    updateSchemaGeneric(schema, document, jsonTypeAdapter);
}

export function getSchemaFromDocument(document: NoSQLDocument): JSONSchema {
    const schema: JSONSchema = {};
    updateSchemaGeneric(schema, document, jsonTypeAdapter);
    return schema;
}

export function getSchemaFromDocuments(documents: NoSQLDocument[]): JSONSchema {
    if (documents.length === 0) {
        throw new Error('No documents provided');
    }

    const schema: JSONSchema = {};
    for (const doc of documents) {
        updateSchemaGeneric(schema, doc, jsonTypeAdapter);
    }

    simplifySchema(schema);
    return schema;
}

