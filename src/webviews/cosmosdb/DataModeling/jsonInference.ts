/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Client-side JSON schema inference for the Data page's "Upload JSON" feature.
 * Runs entirely inside the webview (no host round-trip): given the text of a JSON
 * document (or an array of documents), it uses the shared schema analyzer to
 * extract every property, including nested properties, and picks a sensible
 * default partition-key candidate.
 */

import { type JSONSchema, type JSONSchemaRef } from '@azure/cosmosdb-schema-analyzer';
import { getSchemaFromDocuments, type NoSQLDocument } from '@azure/cosmosdb-schema-analyzer/json';
import {
    MAX_DOCUMENT_SIZE_KB,
    type DocumentShape,
    type PropertyRole,
    type PropertyType,
    type SchemaProperty,
} from './models';
import { getPartitionKeyRestriction } from './partitionKeyEligibility';

export class DocumentSizeLimitError extends Error {
    constructor() {
        super('Document size exceeds the 2 MB item limit.');
    }
}

export type InferredProperty = Omit<SchemaProperty, 'id'>;

export interface InferredSchema {
    properties: InferredProperty[];
    /** Partition-key path derived from the chosen candidate, or empty when no field is eligible. */
    partitionKey: string;
    /** Document-shape metrics calculated from the uploaded documents. */
    document: DocumentShape;
    /** Whether the uploaded documents contain arrays or nested objects. */
    hasNestedCollections: boolean;
}

function getDominantSchema(node: JSONSchema): JSONSchema {
    if (!node.anyOf?.length) {
        return node;
    }

    return node.anyOf.reduce<JSONSchema>((dominant, entry) => {
        if (typeof entry === 'boolean') {
            return dominant;
        }

        return (entry['x-typeOccurrence'] ?? 0) > (dominant['x-typeOccurrence'] ?? 0) ? entry : dominant;
    }, node);
}

function toPropertyType(schema: JSONSchema): PropertyType {
    const dominant = getDominantSchema(schema);

    switch (dominant['x-dataType'] ?? dominant.type) {
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'number';
        case 'array':
            return 'array';
        case 'object':
            return 'object';
        default:
            return 'string';
    }
}

function inferRole(name: string, type: PropertyType): PropertyRole {
    const lower = name.toLowerCase();
    if (lower === 'id' || lower.endsWith('id')) {
        return 'key';
    }
    if (type === 'string (ISO)' || /date|time|at$|timestamp/.test(lower)) {
        return 'filter';
    }
    if (/status|type|state|category|role|plan|tier|priority|kind|level/.test(lower)) {
        return 'filter';
    }
    return 'payload';
}

/** Prefer a domain key like `sessionId` over the generic `id`, else first prop. */
function pickPartitionKey(names: string[]): string | undefined {
    const domainId = names.find((name) => /id$/i.test(name) && name.toLowerCase() !== 'id');
    if (domainId) {
        return domainId;
    }
    const genericId = names.find((name) => name.toLowerCase() === 'id');
    return genericId ?? names[0];
}

function isSchema(schema: JSONSchemaRef | undefined): schema is JSONSchema {
    return typeof schema === 'object' && schema !== null;
}

function isDocument(value: unknown): value is NoSQLDocument {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toKilobytes(value: number): number {
    return Math.round((value / 1024) * 100) / 100;
}

function inferDocumentShape(documents: NoSQLDocument[], attributeCount: number): DocumentShape {
    const sizes = documents.map((document) => new TextEncoder().encode(JSON.stringify(document)).length);
    if (sizes.some((size) => size > MAX_DOCUMENT_SIZE_KB * 1024)) {
        throw new DocumentSizeLimitError();
    }
    return {
        attributeCount,
        avgSizeKb: toKilobytes(sizes.reduce((total, size) => total + size, 0) / sizes.length),
        maxSizeKb: toKilobytes(Math.max(...sizes)),
    };
}

function hasNestedCollections(documents: NoSQLDocument[]): boolean {
    return documents.some((document) =>
        Object.values(document).some((value) => Array.isArray(value) || isDocument(value)),
    );
}

function getSchemaVariants(schema: JSONSchemaRef | JSONSchemaRef[] | undefined): JSONSchema[] {
    if (Array.isArray(schema)) {
        return schema.filter(isSchema);
    }

    if (!isSchema(schema)) {
        return [];
    }

    return schema.anyOf?.filter(isSchema) ?? [schema];
}

/**
 * Adds each property node to the result, then recurses into nested object
 * properties and object elements in arrays. An object can appear in a
 * polymorphic `anyOf`, so all object branches must be visited to avoid
 * omitting fields only present in a less common document shape.
 */
function flattenProperties(
    schema: JSONSchema,
    parentPath = '',
    result = new Map<string, InferredProperty>(),
    hasArrayAncestor = false,
): Map<string, InferredProperty> {
    if (schema.type === 'array') {
        for (const variant of getSchemaVariants(schema.items)) {
            flattenProperties(variant, parentPath, result, true);
        }
        return result;
    }

    for (const [name, child] of Object.entries(schema.properties ?? {})) {
        if (!isSchema(child)) {
            continue;
        }

        const path = parentPath ? `${parentPath}/${name}` : name;
        const type = toPropertyType(child);
        const variants = getSchemaVariants(child);
        result.set(path, {
            ...result.get(path),
            name: path,
            type,
            role: inferRole(path, type),
            pkCandidate: false,
            ...(hasArrayAncestor ? { hasArrayAncestor: true } : {}),
            ...(type !== 'object' &&
            type !== 'array' &&
            variants.some((variant) => variant.type === 'object' || variant.type === 'array')
                ? { hasNonScalarValues: true }
                : {}),
        });

        const traversesArray = hasArrayAncestor || variants.some((variant) => variant.type === 'array');
        for (const variant of variants) {
            flattenProperties(variant, path, result, traversesArray);
        }
    }

    return result;
}

/**
 * Parse `text` and infer a container schema. Accepts a single JSON object or an
 * array of objects. Throws if the text is not valid JSON or does not contain an
 * object with properties.
 */
export function inferSchemaFromJson(text: string): InferredSchema {
    const parsed: unknown = JSON.parse(text);
    const docs: NoSQLDocument[] = [];
    const addDocument = (value: unknown) => {
        if (isDocument(value)) {
            docs.push(value);
        }
    };

    if (Array.isArray(parsed)) {
        parsed.forEach(addDocument);
    } else {
        addDocument(parsed);
    }

    if (docs.length === 0) {
        throw new Error('The JSON does not contain an object with properties.');
    }

    const properties = [...flattenProperties(getSchemaFromDocuments(docs)).values()];
    const pkName = pickPartitionKey(
        properties
            .filter((property) => !getPartitionKeyRestriction(property, properties))
            .map((property) => property.name),
    );

    for (const property of properties) {
        property.pkCandidate = property.name === pkName;
    }

    return {
        properties,
        partitionKey: pkName ? `/${pkName}` : '',
        document: inferDocumentShape(docs, properties.length),
        hasNestedCollections: hasNestedCollections(docs),
    };
}
