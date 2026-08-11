/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@cosmosdb/schema-analyzer';

/**
 * `x-*` extensions that encode value-derived statistics computed from the actual documents that
 * were inspected. They are stripped from schemas before they are handed to the language model for
 * two reasons: they are dense statistics the model cannot use meaningfully (they consume the
 * majority of bytes in deep schemas), and — more importantly — several of them expose the real
 * values observed in the data (`x-minValue` / `x-maxValue` are the actual numeric extremes;
 * `x-minLength` / `x-maxLength` the actual string lengths; `x-trueCount` / `x-falseCount` the
 * actual boolean distribution).  None of these may reach the model.
 *
 * `x-occurrence`, `x-typeOccurrence`, `x-dataType` and `x-bsonType` are intentionally NOT included
 * here: the popularity cut depends on them and the schema format documentation (see
 * `packages/schema-analyzer/docs/schema-format.md`) treats `x-dataType` / `x-bsonType` as part of
 * the public type tag.
 */
export const NOISY_STAT_KEYS = new Set<string>([
    'x-documentsInspected',
    'x-minProperties',
    'x-maxProperties',
    'x-minItems',
    'x-maxItems',
    'x-minLength',
    'x-maxLength',
    'x-minValue',
    'x-maxValue',
    'x-minDate',
    'x-maxDate',
    'x-trueCount',
    'x-falseCount',
]);

/**
 * Deep-clones a schema. Schemas are tree-shaped JSON, so `structuredClone` is the safest deep copy.
 */
export function deepCloneSchema(schema: JSONSchema): JSONSchema {
    return structuredClone(schema);
}

/**
 * Removes every {@link NOISY_STAT_KEYS} entry from `node` and all of its descendants
 * (`properties`, `anyOf` branches and array `items`), mutating in place. Returns `true` when at
 * least one key was removed.
 */
export function stripNoisyStats(node: JSONSchema | undefined): boolean {
    if (!node || typeof node !== 'object') return false;
    let mutated = false;

    for (const key of Object.keys(node)) {
        if (NOISY_STAT_KEYS.has(key)) {
            delete (node as Record<string, unknown>)[key];
            mutated = true;
        }
    }

    if (node.properties) {
        for (const child of Object.values(node.properties)) {
            if (typeof child === 'object') {
                mutated = stripNoisyStats(child) || mutated;
            }
        }
    }
    if (node.anyOf) {
        for (const entry of node.anyOf) {
            if (typeof entry === 'object') {
                mutated = stripNoisyStats(entry) || mutated;
            }
        }
    }
    if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
        mutated = stripNoisyStats(node.items) || mutated;
    }

    return mutated;
}

/**
 * Returns a deep-cloned copy of `schema` with all value-derived statistics ({@link NOISY_STAT_KEYS},
 * e.g. `x-minValue` / `x-maxValue` / `x-minLength` / `x-maxLength`) removed at every level.
 *
 * Unlike the aggressive simplification in `SchemaService`, this performs no popularity-based
 * property trimming or byte-budget shaping — it only strips the confidential, value-derived
 * extremes.  It is the minimal transform that inferred *result* and *query-history* schemas must
 * pass through before they are serialized into a language-model tool result, so that no actual
 * document values (numeric min/max, string lengths, boolean counts) ever reach the model.  Schemas
 * built directly from live documents via `getSchemaFromDocuments` carry these keys, so every such
 * schema handed to the LLM must be routed through this helper first.
 */
export function stripSchemaStatistics(schema: JSONSchema): JSONSchema {
    const clone = deepCloneSchema(schema);
    stripNoisyStats(clone);
    return clone;
}
