/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '../JSONSchema.js';

/** Reads observed type variants without changing expanded or simplified analyzer output. */
export function getTypeEntries(schema: JSONSchema): JSONSchema[] {
    if (schema.anyOf?.length) {
        return schema.anyOf.filter((entry): entry is JSONSchema => typeof entry !== 'boolean');
    }
    return schema.type ? [schema] : [];
}

/**
 * Restores the accumulator representation of an analyzer-produced property or items node.
 * Only x-occurrence belongs to the property wrapper; all other fields describe the observed type,
 * including its structure, keywords and extensions. Untouched nodes need not be expanded.
 */
export function expandTypeEntries(schema: JSONSchema): JSONSchema[] {
    if (schema.type) {
        const fields = Object.entries(schema).filter(([key]) => key !== 'x-occurrence');
        const entry: JSONSchema = Object.fromEntries(fields);
        for (const [key] of fields) {
            delete (schema as Record<string, unknown>)[key];
        }
        schema.anyOf = [entry];
    }

    schema.anyOf ??= [];
    return schema.anyOf as JSONSchema[];
}
