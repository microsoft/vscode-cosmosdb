/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Client-side JSON → schema inference for the Data page's "Upload JSON"
 * feature. Runs entirely inside the webview (no host round-trip): given the text
 * of a JSON document (or an array of documents), it extracts the top-level
 * properties, infers a {@link PropertyType} and {@link PropertyRole} for each,
 * and picks a sensible default partition-key candidate.
 */

import { type PropertyRole, type PropertyType } from './models';

export interface InferredProperty {
    name: string;
    type: PropertyType;
    role: PropertyRole;
    pkCandidate: boolean;
}

export interface InferredSchema {
    properties: InferredProperty[];
    /** Partition-key path derived from the chosen candidate, e.g. `/sessionId`. */
    partitionKey: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function inferType(value: unknown): PropertyType {
    if (typeof value === 'boolean') {
        return 'boolean';
    }
    if (typeof value === 'number') {
        return 'number';
    }
    if (typeof value === 'string') {
        if (GUID.test(value)) {
            return 'guid';
        }
        if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) {
            return 'string (ISO)';
        }
        return 'string';
    }
    if (Array.isArray(value)) {
        return value.length > 0 && value.every((v) => typeof v === 'number') ? 'number[]' : 'array';
    }
    return 'object';
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
    const domainId = names.find((n) => /id$/i.test(n) && n.toLowerCase() !== 'id');
    if (domainId) {
        return domainId;
    }
    const genericId = names.find((n) => n.toLowerCase() === 'id');
    return genericId ?? names[0];
}

/**
 * Parse `text` and infer a container schema. Accepts a single JSON object or an
 * array of objects (keys are unioned across array elements). Throws if the text
 * is not valid JSON or does not contain any object with properties.
 */
export function inferSchemaFromJson(text: string): InferredSchema {
    const parsed: unknown = JSON.parse(text);

    // Collect candidate documents: the object itself, or the objects in an array.
    const docs: Record<string, unknown>[] = [];
    const pushIfObject = (v: unknown) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            docs.push(v as Record<string, unknown>);
        }
    };
    if (Array.isArray(parsed)) {
        parsed.forEach(pushIfObject);
    } else {
        pushIfObject(parsed);
    }

    if (docs.length === 0) {
        throw new Error('The JSON does not contain an object with properties.');
    }

    // Union keys across docs, preserving first-seen order; infer type from the
    // first non-null value seen for each key.
    const order: string[] = [];
    const typeByName = new Map<string, PropertyType>();
    for (const doc of docs) {
        for (const [name, value] of Object.entries(doc)) {
            if (!typeByName.has(name)) {
                order.push(name);
            }
            const existing = typeByName.get(name);
            if (existing === undefined || (existing === 'object' && value !== null)) {
                if (value !== null && value !== undefined) {
                    typeByName.set(name, inferType(value));
                } else if (existing === undefined) {
                    typeByName.set(name, 'string');
                }
            }
        }
    }

    const pkName = pickPartitionKey(order);
    const properties: InferredProperty[] = order.map((name) => {
        const type = typeByName.get(name) ?? 'string';
        return {
            name,
            type,
            role: inferRole(name, type),
            pkCandidate: name === pkName,
        };
    });

    return {
        properties,
        partitionKey: pkName ? `/${pkName}` : '/id',
    };
}
