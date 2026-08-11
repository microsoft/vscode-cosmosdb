/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NOISY_STAT_KEYS } from './schemaStatistics';

/**
 * The value-derived statistic keys that must never reach the language model. Derived directly from
 * the production {@link NOISY_STAT_KEYS} set so the confidentiality tests always check exactly what
 * production strips: adding a key to `NOISY_STAT_KEYS` automatically extends the guarantee the tests
 * assert.
 */
export const CONFIDENTIAL_STAT_KEYS: readonly string[] = [...NOISY_STAT_KEYS];

/**
 * Recursively collects every property key that appears anywhere in `value` (objects and arrays are
 * walked to arbitrary depth). Used by confidentiality tests to scan a fully serialized tool payload
 * for forbidden keys, rather than checking only the top level.
 */
export function collectSchemaKeys(value: unknown, acc: Set<string> = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectSchemaKeys(item, acc);
        }
    } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            acc.add(key);
            collectSchemaKeys(child, acc);
        }
    }
    return acc;
}

/**
 * Returns the {@link CONFIDENTIAL_STAT_KEYS} that appear anywhere in `payload`. An empty array means
 * the payload is free of value-derived statistics; a non-empty array names exactly what leaked,
 * which makes test failures self-explanatory.
 */
export function findConfidentialStatKeys(payload: unknown): string[] {
    const keys = collectSchemaKeys(payload);
    return CONFIDENTIAL_STAT_KEYS.filter((key) => keys.has(key));
}
