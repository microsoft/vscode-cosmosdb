/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FeatureResult } from '@azure/arm-features';

const THROUGHPUT_BUCKETS_FEATURE = 'ThroughputBuckets';

/** Cosmos DB supports at most five throughput buckets per container. */
export const MAX_THROUGHPUT_BUCKETS = 5;

export function isThroughputBucketsFeatureRegistered(feature: FeatureResult): boolean {
    const featureName = feature.name?.split('/').pop();
    return (
        featureName?.toLowerCase() === THROUGHPUT_BUCKETS_FEATURE.toLowerCase() &&
        feature.properties?.state?.toLowerCase() === 'registered'
    );
}

/**
 * Maps the raw ARM `throughputSettings` response body to a fixed-length array of
 * per-bucket enabled flags (index `i` corresponds to bucket id `i + 1`).
 *
 * A bucket is considered enabled when it appears in the container's (or
 * shared-throughput database's) configured `throughputBuckets` list. Buckets
 * that are not configured are reported as disabled so the query editor only
 * offers the ones the user can actually select.
 */
export function parseEnabledThroughputBuckets(body: unknown, max: number = MAX_THROUGHPUT_BUCKETS): boolean[] {
    const flags = Array.from<boolean>({ length: max }).fill(false);

    const buckets = (body as { properties?: { resource?: { throughputBuckets?: unknown } } } | undefined)?.properties
        ?.resource?.throughputBuckets;
    if (!Array.isArray(buckets)) {
        return flags;
    }

    for (const bucket of buckets) {
        const id = (bucket as { id?: unknown } | undefined)?.id;
        if (typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= max) {
            flags[id - 1] = true;
        }
    }

    return flags;
}
