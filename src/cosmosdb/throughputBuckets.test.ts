/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isThroughputBucketsFeatureRegistered } from './throughputBucketsFeature';

describe('isThroughputBucketsFeatureRegistered', () => {
    it('returns true for the registered Throughput Buckets feature', () => {
        expect(
            isThroughputBucketsFeatureRegistered({
                name: 'Microsoft.DocumentDB/ThroughputBuckets',
                properties: { state: 'Registered' },
            }),
        ).toBe(true);
    });

    it('matches the feature name and state case-insensitively', () => {
        expect(
            isThroughputBucketsFeatureRegistered({
                name: 'microsoft.documentdb/throughputbuckets',
                properties: { state: 'REGISTERED' },
            }),
        ).toBe(true);
    });

    it.each(['NotRegistered', 'Pending', 'Registering', 'Unregistered'])(
        'returns false when the feature state is %s',
        (state) => {
            expect(
                isThroughputBucketsFeatureRegistered({
                    name: 'Microsoft.DocumentDB/ThroughputBuckets',
                    properties: { state },
                }),
            ).toBe(false);
        },
    );

    it('returns false for unrelated registered features', () => {
        expect(
            isThroughputBucketsFeatureRegistered({
                name: 'Microsoft.DocumentDB/EnablePriorityBasedExecution',
                properties: { state: 'Registered' },
            }),
        ).toBe(false);
    });
});
