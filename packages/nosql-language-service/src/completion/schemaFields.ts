/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Schema field extraction for CosmosDB NoSQL SQL completion
// ---------------------------------------------------------------------------

import { type JSONSchema } from '@cosmosdb/schema-analyzer';
import { type CompletionItem } from './types.js';

export function getFieldsFromSchema(schema: JSONSchema | undefined, path: string[]): CompletionItem[] {
    if (!schema?.properties) return [];

    // Navigate to the right level
    let current: JSONSchema = schema;
    for (const segment of path) {
        const prop = current.properties?.[segment];
        if (!prop || typeof prop === 'boolean') return [];
        current = prop as JSONSchema;
        // If it's an array, look at items
        if (current.type === 'array' && current.items && !Array.isArray(current.items)) {
            current = current.items as JSONSchema;
        }
    }

    if (!current.properties) return [];

    return Object.entries(current.properties).map(([name, propSchema]) => {
        const ps = propSchema as JSONSchema;
        const occurrence = ps['x-occurrence'] ?? 0;
        const type = Array.isArray(ps.type) ? ps.type[0] : (ps.type ?? 'unknown');
        return {
            label: name,
            kind: 'field' as const,
            detail: type,
            // Sort by occurrence descending — pad with leading zeros for lexicographic sort
            sortText: String(1000 - occurrence).padStart(4, '0') + name,
        };
    });
}

export function getTopLevelFields(schema: JSONSchema | undefined): CompletionItem[] {
    return getFieldsFromSchema(schema, []);
}

