/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema inference for MongoDB API / DocumentDB API documents (BSON).
 *
 * Uses the shared core traversal with a BSON-specific type adapter.
 * Schema output uses `x-bsonType` for the original BSON type tag.
 */

import { type Document, type WithId } from 'mongodb';
import { type JSONSchema } from '../JSONSchema.js';
import { type TypeAdapter, updateSchemaWithDocument as updateSchemaGeneric } from '../core/schemaTraversal.js';
import { type BSONType, bsonTypeToJSONType, inferBsonType } from './BSONTypes.js';

export { buildFullPaths, getPropertyNamesAtLevel, simplifySchema } from '../core/schemaUtils.js';

// Re-export getKnownFields pre-bound to BSON's type extension key
import { type FieldEntry, getKnownFields as getKnownFieldsGeneric } from '../core/schemaUtils.js';
export type { FieldEntry } from '../core/schemaUtils.js';

function getKnownFieldsBson(schema: JSONSchema): FieldEntry[] {
    return getKnownFieldsGeneric(schema, 'x-bsonType');
}

// ── BSON Type Adapter ──────────────────────────────────────────────────

const bsonTypeAdapter: TypeAdapter<BSONType> = {
    inferType: inferBsonType,
    toJSONType: bsonTypeToJSONType,
    typeExtensionKey: 'x-bsonType',
    trackNestedObjectDocs: true,

    initializeStats(value: unknown, type: BSONType, entry: JSONSchema): void {
        switch (type) {
            case 'string': {
                const len = (value as string).length;
                entry['x-maxLength'] = len;
                entry['x-minLength'] = len;
                break;
            }
            case 'number':
            case 'int32':
            case 'long':
            case 'double':
            case 'decimal128': {
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
            case 'date': {
                const d = (value as Date).getTime();
                entry['x-maxDate'] = d;
                entry['x-minDate'] = d;
                break;
            }
            case 'binary': {
                const len = (value as Buffer).length;
                entry['x-maxLength'] = len;
                entry['x-minLength'] = len;
                break;
            }
            default:
                break;
        }
    },

    aggregateStats(value: unknown, type: BSONType, entry: JSONSchema): void {
        switch (type) {
            case 'string': {
                const len = (value as string).length;
                if (entry['x-minLength'] === undefined || len < entry['x-minLength']) entry['x-minLength'] = len;
                if (entry['x-maxLength'] === undefined || len > entry['x-maxLength']) entry['x-maxLength'] = len;
                break;
            }
            case 'number':
            case 'int32':
            case 'long':
            case 'double':
            case 'decimal128': {
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
            case 'date': {
                const d = (value as Date).getTime();
                if (entry['x-minDate'] === undefined || d < entry['x-minDate']) entry['x-minDate'] = d;
                if (entry['x-maxDate'] === undefined || d > entry['x-maxDate']) entry['x-maxDate'] = d;
                break;
            }
            case 'binary': {
                const len = (value as Buffer).length;
                if (entry['x-minLength'] === undefined || len < entry['x-minLength']) entry['x-minLength'] = len;
                if (entry['x-maxLength'] === undefined || len > entry['x-maxLength']) entry['x-maxLength'] = len;
                break;
            }
            default:
                break;
        }
    },
};

// ── SchemaAnalyzer class ───────────────────────────────────────────────

/**
 * Incremental schema analyzer for documents from the MongoDB API / DocumentDB API.
 *
 * Analyzes documents one at a time (or in batches) and builds a cumulative
 * JSON Schema with statistical extensions (x-occurrence, x-bsonType, etc.).
 */
export class SchemaAnalyzer {
    private _schema: JSONSchema = {};
    private _version: number = 0;
    private _knownFieldsCache: FieldEntry[] | null = null;
    private _knownFieldsCacheVersion: number = -1;

    get version(): number {
        return this._version;
    }

    addDocument(document: WithId<Document>): void {
        updateSchemaGeneric(this._schema, document, bsonTypeAdapter);
        this._version++;
    }

    addDocuments(documents: ReadonlyArray<WithId<Document>>): void {
        for (const doc of documents) {
            updateSchemaGeneric(this._schema, doc, bsonTypeAdapter);
        }
        this._version++;
    }

    getSchema(): JSONSchema {
        return this._schema;
    }

    getDocumentCount(): number {
        return (this._schema['x-documentsInspected'] as number) ?? 0;
    }

    reset(): void {
        this._schema = {};
        this._version++;
    }

    clone(): SchemaAnalyzer {
        const copy = new SchemaAnalyzer();
        copy._schema = structuredClone(this._schema);
        return copy;
    }

    getKnownFields(): FieldEntry[] {
        if (this._knownFieldsCacheVersion !== this._version || this._knownFieldsCache === null) {
            this._knownFieldsCache = getKnownFieldsBson(this._schema);
            this._knownFieldsCacheVersion = this._version;
        }
        return this._knownFieldsCache;
    }

    static fromDocument(document: WithId<Document>): SchemaAnalyzer {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocument(document);
        return analyzer;
    }

    static fromDocuments(documents: ReadonlyArray<WithId<Document>>): SchemaAnalyzer {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocuments(documents);
        return analyzer;
    }
}
