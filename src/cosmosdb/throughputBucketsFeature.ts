/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FeatureResult } from '@azure/arm-features';

const THROUGHPUT_BUCKETS_FEATURE = 'ThroughputBuckets';

export function isThroughputBucketsFeatureRegistered(feature: FeatureResult): boolean {
    const featureName = feature.name?.split('/').pop();
    return (
        featureName?.toLowerCase() === THROUGHPUT_BUCKETS_FEATURE.toLowerCase() &&
        feature.properties?.state?.toLowerCase() === 'registered'
    );
}
