/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// #region example
import { type JSONSchema } from '@azure/cosmosdb-schema-analyzer';
import {
    getSchemaFromDocuments,
    type NoSQLDocument,
} from '@azure/cosmosdb-schema-analyzer/json';

// #region infer-schema
/** Accept JSON text, not JavaScript expressions or a pre-authored schema. */
export function inferSchema(documentsJson: string): JSONSchema {
    if (!documentsJson.trim()) {
        throw new Error(
            'Enter a non-empty JSON array of documents, ' +
                'for example [{"id":"1"}].',
        );
    }

    // Parse data, never evaluate JavaScript. Keep the result unknown until
    // we have checked that it is a non-empty array of document objects.
    const parsed: unknown = JSON.parse(documentsJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Documents must be a non-empty JSON array of objects.');
    }

    const documents: unknown[] = parsed;
    if (!documents.every(isDocument)) {
        throw new Error(
            'Each document must be a JSON object. ' +
                'Null, arrays, and primitive values are not documents.',
        );
    }

    // Guard the published 1.0.0 analyzer before it touches any documents.
    validatePropertyNames(documents);
    // Merge observed fields, type alternatives and occurrence statistics.
    // The result describes this sample; it is not a collection constraint.
    return getSchemaFromDocuments(documents);
}
// #endregion infer-schema

function isDocument(value: unknown): value is NoSQLDocument {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePropertyNames(documents: NoSQLDocument[]): void {
    const pending: unknown[] = [...documents];
    while (pending.length) {
        const value = pending.pop();
        if (Array.isArray(value)) {
            const items: unknown[] = value;
            for (const item of items) pending.push(item);
        } else if (isDocument(value)) {
            for (const [key, child] of Object.entries(value)) {
                // Version 1.0.0 uses plain objects as property maps.
                // Reject inherited names throughout the input before inference
                // so they cannot corrupt this or subsequent analyses.
                if (
                    Object.hasOwn(Object.prototype, key) ||
                    key === 'prototype'
                ) {
                    throw new Error(
                        `Property "${key}" is not supported ` +
                            'by schema analyzer 1.0.0.',
                    );
                }
                pending.push(child);
            }
        }
    }
}
// #endregion example
