/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PARTITION_THRESHOLDS,
    derivePartitionTiles,
    deriveSkewScore,
    getPartitionHealth,
    intensityLevel,
} from './partitionHealth';
import { iso, mockClient, pdims } from './testFixtures';

describe('intensityLevel', () => {
    it('is level 1 for a zero share', () => {
        expect(intensityLevel(0, 40)).toBe(1);
    });

    it('is level 5 at or above the hot threshold', () => {
        expect(intensityLevel(40, 40)).toBe(5);
        expect(intensityLevel(75, 40)).toBe(5);
    });

    it('spreads sub-threshold shares across levels 1-4', () => {
        expect(intensityLevel(5, 40)).toBe(1); // ratio 0.125
        expect(intensityLevel(15, 40)).toBe(2); // ratio 0.375
        expect(intensityLevel(25, 40)).toBe(3); // ratio 0.625
        expect(intensityLevel(38, 40)).toBe(4); // ratio 0.95
    });
});

describe('derivePartitionTiles', () => {
    it('computes shares, sorts descending, and flags hot partitions', () => {
        const weights = new Map([
            ['0', 70],
            ['1', 20],
            ['2', 10],
        ]);
        const { tiles, topPartitionShare } = derivePartitionTiles(weights, 40);
        expect(tiles.map((t) => t.partitionId)).toEqual(['0', '1', '2']);
        expect(topPartitionShare).toBeCloseTo(70);
        expect(tiles[0].hot).toBe(true);
        expect(tiles[0].level).toBe(5);
        expect(tiles[1].hot).toBe(false);
    });

    it('yields even shares with no hot partition for a balanced distribution', () => {
        const weights = new Map([
            ['0', 25],
            ['1', 25],
            ['2', 25],
            ['3', 25],
        ]);
        const { tiles, topPartitionShare } = derivePartitionTiles(weights, 40);
        expect(topPartitionShare).toBeCloseTo(25);
        expect(tiles.every((t) => !t.hot)).toBe(true);
    });

    it('returns zero shares when all weights are zero', () => {
        const { tiles, topPartitionShare } = derivePartitionTiles(new Map([['0', 0]]), 40);
        expect(topPartitionShare).toBe(0);
        expect(tiles[0].sharePercent).toBe(0);
    });
});

describe('deriveSkewScore', () => {
    it('is the worst per-timestamp top share, as a percentage', () => {
        const t1 = 1_000;
        const t2 = 2_000;
        const matrix = new Map<string, Map<number, number>>([
            [
                '0',
                new Map([
                    [t1, 80],
                    [t2, 10],
                ]),
            ],
            [
                '1',
                new Map([
                    [t1, 20],
                    [t2, 10],
                ]),
            ],
        ]);
        // t1: 80/100 = 0.8; t2: 10/20 = 0.5 → worst 0.8.
        expect(deriveSkewScore(matrix)).toBeCloseTo(80);
    });

    it('is zero for an empty matrix', () => {
        expect(deriveSkewScore(new Map())).toBe(0);
    });
});

describe('getPartitionHealth', () => {
    const base = Date.now();
    const partitionThresholds = DEFAULT_PARTITION_THRESHOLDS;

    it('returns available: false when no partition series are present', async () => {
        const client = mockClient({});
        const result = await getPartitionHealth(client, '/sub/acct', 'ru', '1H', 'db', 'c1', partitionThresholds);
        expect(result.available).toBe(false);
        expect(result.tiles).toEqual([]);
    });

    it('computes RU shares, skew score, and hot flags for a skewed container', async () => {
        const client = mockClient({
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: pdims('db', 'c1', 'PartitionKeyRangeId', '0'),
                                data: [{ timeStamp: iso(base), maximum: 90 }],
                            },
                            {
                                metadatavalues: pdims('db', 'c1', 'PartitionKeyRangeId', '1'),
                                data: [{ timeStamp: iso(base), maximum: 10 }],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getPartitionHealth(client, '/sub/acct', 'ru', '1H', 'db', 'c1', partitionThresholds);
        expect(result.available).toBe(true);
        expect(result.mode).toBe('ru');
        expect(result.partitionCount).toBe(2);
        expect(result.tiles[0].partitionId).toBe('0');
        expect(result.tiles[0].sharePercent).toBeCloseTo(90);
        expect(result.tiles[0].hot).toBe(true);
        expect(result.topPartitionShare).toBeCloseTo(90);
        expect(result.skewScore).toBeCloseTo(90);
        expect(result.hotThresholdPercent).toBe(DEFAULT_PARTITION_THRESHOLDS.hotRuSharePercent);
    });

    it('ranks storage partitions by their latest reported size', async () => {
        const client = mockClient({
            PhysicalPartitionSizeInfo: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: pdims('db', 'c1', 'PhysicalPartitionId', 'p0'),
                                data: [
                                    { timeStamp: iso(base - 60_000), maximum: 10 },
                                    { timeStamp: iso(base), maximum: 50 },
                                ],
                            },
                            {
                                metadatavalues: pdims('db', 'c1', 'PhysicalPartitionId', 'p1'),
                                data: [{ timeStamp: iso(base), maximum: 50 }],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getPartitionHealth(client, '/sub/acct', 'storage', '24H', 'db', 'c1', partitionThresholds);
        expect(result.available).toBe(true);
        expect(result.mode).toBe('storage');
        // Latest sizes 50 / 50 → even 50% shares (both above the 35% storage-skew threshold).
        expect(result.topPartitionShare).toBeCloseTo(50);
        expect(result.hotThresholdPercent).toBe(DEFAULT_PARTITION_THRESHOLDS.skewedStorageSharePercent);
        expect(result.skewScore).toBeCloseTo(result.topPartitionShare);
    });
});
