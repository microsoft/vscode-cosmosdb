/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    isThroughputBucketsFeatureRegistered,
    MAX_THROUGHPUT_BUCKETS,
    parseEnabledThroughputBuckets,
} from './throughputBucketsFeature';

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

describe('parseEnabledThroughputBuckets', () => {
    const enabled = (...ids: number[]): boolean[] =>
        Array.from({ length: MAX_THROUGHPUT_BUCKETS }, (_, index) => ids.includes(index + 1));

    it('marks configured buckets as enabled and the rest as disabled', () => {
        const body = {
            properties: {
                resource: {
                    throughput: 400,
                    throughputBuckets: [
                        { id: 1, maxThroughputPercentage: 50 },
                        { id: 3, maxThroughputPercentage: 30 },
                    ],
                },
            },
        };

        expect(parseEnabledThroughputBuckets(body)).toEqual(enabled(1, 3));
    });

    it('reports all buckets disabled when none are configured', () => {
        const body = { properties: { resource: { throughput: 400, throughputBuckets: [] } } };

        expect(parseEnabledThroughputBuckets(body)).toEqual(enabled());
    });

    it('ignores bucket ids outside the supported range', () => {
        const body = {
            properties: {
                resource: {
                    throughputBuckets: [{ id: 0 }, { id: 2 }, { id: 6 }, { id: 2.5 }, { id: '4' }],
                },
            },
        };

        expect(parseEnabledThroughputBuckets(body)).toEqual(enabled(2));
    });

    it.each([undefined, null, {}, { properties: {} }, { properties: { resource: {} } }, 'not-json'])(
        'reports all buckets disabled for malformed body %p',
        (body) => {
            expect(parseEnabledThroughputBuckets(body)).toEqual(enabled());
        },
    );

    it('honours a custom maximum bucket count', () => {
        const body = { properties: { resource: { throughputBuckets: [{ id: 2 }, { id: 3 }] } } };

        expect(parseEnabledThroughputBuckets(body, 3)).toEqual([false, true, true]);
    });
});
