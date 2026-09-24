/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { RANGE_CONFIG } from '../../../panels/accountOverview/services/shared';
import { type MetricSeriesResult } from '../../api/types';
import { normalizedRuIntervals } from './overviewRuDetailsModel';

const snapshot = (overrides: Partial<MetricSeriesResult> = {}): MetricSeriesResult => ({
    metric: 'normalizedRu',
    available: true,
    timeRange: '24H',
    generatedAt: 86_400_000,
    points: [],
    ...overrides,
});

describe('normalized RU interval estimate', () => {
    it.each(['1H', '24H', '7D'] as const)(
        'uses the provider bucket size for %s and excludes exactly 80%%',
        (timeRange) => {
            const { bucketMs, windowMs } = RANGE_CONFIG[timeRange];
            const result = normalizedRuIntervals(
                snapshot({
                    timeRange,
                    generatedAt: windowMs,
                    points: [
                        { timestamp: 0, value: 80 },
                        { timestamp: bucketMs, value: 81 },
                        { timestamp: 2 * bucketMs, value: 100 },
                    ],
                }),
            );
            expect(result.aboveMs).toBe(2 * bucketMs);
            expect(result.observedMs).toBe(3 * bucketMs);
            expect(result.windowMs).toBe(windowMs);
        },
    );

    it('sorts, deduplicates and preserves missing buckets as chart gaps rather than sustained elevation', () => {
        const result = normalizedRuIntervals(
            snapshot({
                points: [
                    { timestamp: 900_000, value: 95 },
                    { timestamp: 0, value: 100 },
                    { timestamp: 0, value: 81 },
                    { timestamp: 0, value: undefined },
                ],
            }),
        );
        expect(result.aboveMs).toBe(600_000);
        expect(result.observedMs).toBe(600_000);
        expect(result.points).toEqual([
            { timestamp: 0, value: 100 },
            { timestamp: 300_000, value: undefined },
            { timestamp: 900_000, value: 95 },
        ]);
    });

    it('excludes incomplete, future and out-of-window buckets', () => {
        const result = normalizedRuIntervals(
            snapshot({
                points: [
                    { timestamp: -300_000, value: 100 },
                    { timestamp: 0, value: 90 },
                    { timestamp: 86_100_000, value: 80 },
                    { timestamp: 86_200_000, value: 100 },
                    { timestamp: 86_400_000, value: 100 },
                ],
            }),
        );
        expect(result.aboveMs).toBe(300_000);
        expect(result.observedMs).toBe(600_000);
    });

    it('does not convert missing or invalid measurements into a measured zero', () => {
        const result = normalizedRuIntervals(
            snapshot({
                points: [
                    { timestamp: 0 },
                    { timestamp: 300_000, value: 101 },
                    { timestamp: 600_000, value: -1 },
                    { timestamp: 900_000, value: Number.NaN },
                    { timestamp: Number.NaN, value: 100 },
                ],
            }),
        );
        expect(result.aboveMs).toBeUndefined();
        expect(result.observedMs).toBe(0);
        expect(result.points.every((point) => point.value === undefined)).toBe(true);
        expect(normalizedRuIntervals(snapshot({ points: [{ timestamp: 0, value: 0 }] })).aboveMs).toBe(0);
    });

    it.each([
        { generatedAt: Number.NaN },
        { generatedAt: Number.MAX_VALUE },
        { available: false },
        { metric: 'totalRequests' as const },
    ])('rejects invalid snapshot metadata %j', (override) => {
        const result = normalizedRuIntervals(snapshot({ points: [{ timestamp: 0, value: 100 }], ...override }));
        expect(result.points).toEqual([]);
        expect(result.aboveMs).toBeUndefined();
    });
});
