/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PARTITION_THRESHOLDS,
    deriveRuSaturationTiles,
    deriveSkewScore,
    deriveStorageTiles,
    getPartitionHealth,
    levelFromExcess,
} from './partitionHealth';
import { iso, mockClient, pdims } from './testFixtures';

const GIB = 1024 ** 3;

describe('levelFromExcess', () => {
    it('is level 5 for a hot partition regardless of excess', () => {
        expect(levelFromExcess(0, true)).toBe(5);
        expect(levelFromExcess(0.2, true)).toBe(5);
    });

    it('is level 1 for a zero or negative excess', () => {
        expect(levelFromExcess(0, false)).toBe(1);
        expect(levelFromExcess(-1, false)).toBe(1);
    });

    it('spreads sub-threshold excess across levels 1-4', () => {
        expect(levelFromExcess(0.1, false)).toBe(1); // floor(0.4) → 1
        expect(levelFromExcess(0.3, false)).toBe(2); // floor(1.2) → 2
        expect(levelFromExcess(0.6, false)).toBe(3); // floor(2.4) → 3
        expect(levelFromExcess(0.9, false)).toBe(4); // floor(3.6) → 4
    });

    it('caps a non-hot excess at or above the threshold to level 4', () => {
        expect(levelFromExcess(2, false)).toBe(4);
    });
});

describe('deriveRuSaturationTiles (per-partition p99 saturation)', () => {
    it('flags the saturated partition hot when another still has headroom', () => {
        // Busiest at 95% (≥ 90% saturation) while the coolest sits at 30% (< 70% headroom) → hot partition.
        const p99 = new Map([
            ['0', 95],
            ['1', 40],
            ['2', 30],
        ]);
        const { tiles, stats, hotPartition } = deriveRuSaturationTiles(p99, DEFAULT_PARTITION_THRESHOLDS);
        expect(hotPartition).toBe(true);
        expect(stats.maxP99).toBe(95);
        expect(stats.minP99).toBe(30);
        expect(tiles.map((t) => t.partitionId)).toEqual(['0', '1', '2']);
        expect(tiles[0].sharePercent).toBeCloseTo(95);
        expect(tiles[0].hot).toBe(true);
        expect(tiles[0].level).toBe(5);
        expect(tiles[1].hot).toBe(false);
    });

    it('never flags uniform saturation (every partition busy is under-provisioning, not skew)', () => {
        const p99 = new Map([
            ['0', 95],
            ['1', 92],
            ['2', 88],
        ]);
        const { tiles, hotPartition } = deriveRuSaturationTiles(p99, DEFAULT_PARTITION_THRESHOLDS);
        expect(hotPartition).toBe(false);
        expect(tiles.every((t) => !t.hot)).toBe(true);
    });

    it('does not flag a container where nothing is saturated', () => {
        const p99 = new Map([
            ['0', 60],
            ['1', 20],
        ]);
        const { hotPartition, tiles } = deriveRuSaturationTiles(p99, DEFAULT_PARTITION_THRESHOLDS);
        expect(hotPartition).toBe(false);
        expect(tiles.every((t) => !t.hot)).toBe(true);
    });

    it('never flags a single-partition container', () => {
        const { hotPartition, tiles } = deriveRuSaturationTiles(new Map([['0', 99]]), DEFAULT_PARTITION_THRESHOLDS);
        expect(hotPartition).toBe(false);
        expect(tiles[0].hot).toBe(false);
    });
});

describe('deriveStorageTiles (balance ratio + materiality)', () => {
    it('flags a materially oversized partition as skewed', () => {
        // Coolest 2 GiB ÷ busiest 10 GiB = 0.2 balance ratio (< 0.7) and busiest is material → hot.
        const weights = new Map([
            ['p0', 10 * GIB],
            ['p1', 2 * GIB],
        ]);
        const { tiles } = deriveStorageTiles(weights, DEFAULT_PARTITION_THRESHOLDS);
        expect(tiles[0].partitionId).toBe('p0');
        expect(tiles[0].hot).toBe(true);
        expect(tiles[0].level).toBe(5);
        expect(tiles[1].hot).toBe(false);
    });

    it('does not flag a balanced split', () => {
        const weights = new Map([
            ['p0', 5 * GIB],
            ['p1', 5 * GIB],
        ]);
        const { tiles } = deriveStorageTiles(weights, DEFAULT_PARTITION_THRESHOLDS);
        expect(tiles.every((t) => !t.hot)).toBe(true);
    });

    it('does not flag an imbalanced but immaterial split', () => {
        // Same 0.2 balance ratio, but the busiest partition is well under 1 GiB → not a concern.
        const weights = new Map([
            ['p0', Math.round(0.5 * GIB)],
            ['p1', Math.round(0.1 * GIB)],
        ]);
        const { tiles } = deriveStorageTiles(weights, DEFAULT_PARTITION_THRESHOLDS);
        expect(tiles.every((t) => !t.hot)).toBe(true);
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
        const result = await getPartitionHealth(client, '/sub/acct', 'ru', '7D', 'db', 'c1', partitionThresholds);
        expect(result.available).toBe(false);
        expect(result.tiles).toEqual([]);
    });

    it('computes per-partition p99 saturation and hot flags for a skewed container', async () => {
        const client = mockClient({
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: pdims('db', 'c1', 'PhysicalPartitionId', '0'),
                                data: [{ timeStamp: iso(base), maximum: 95 }],
                            },
                            {
                                metadatavalues: pdims('db', 'c1', 'PhysicalPartitionId', '1'),
                                data: [{ timeStamp: iso(base), maximum: 40 }],
                            },
                            {
                                metadatavalues: pdims('db', 'c1', 'PhysicalPartitionId', '2'),
                                data: [{ timeStamp: iso(base), maximum: 30 }],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getPartitionHealth(client, '/sub/acct', 'ru', '7D', 'db', 'c1', partitionThresholds);
        expect(result.available).toBe(true);
        expect(result.mode).toBe('ru');
        expect(result.partitionCount).toBe(3);
        expect(result.tiles[0].partitionId).toBe('0');
        expect(result.tiles[0].sharePercent).toBeCloseTo(95);
        // Busiest saturated (95% ≥ 90%) while the coolest has headroom (30% < 70%) → hot partition.
        expect(result.tiles[0].hot).toBe(true);
        expect(result.topPartitionShare).toBeCloseTo(95);
        expect(result.maxSaturationPercent).toBeCloseTo(95);
        expect(result.minSaturationPercent).toBeCloseTo(30);
        expect(result.hotPartition).toBe(true);
    });

    it('does not flag hot partitions under uniform saturation', async () => {
        const client = mockClient({
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: pdims('db', 'c1', 'PhysicalPartitionId', '0'),
                                data: [{ timeStamp: iso(base), maximum: 95 }],
                            },
                            {
                                metadatavalues: pdims('db', 'c1', 'PhysicalPartitionId', '1'),
                                data: [{ timeStamp: iso(base), maximum: 90 }],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getPartitionHealth(client, '/sub/acct', 'ru', '7D', 'db', 'c1', partitionThresholds);
        expect(result.available).toBe(true);
        expect(result.hotPartition).toBe(false);
        expect(result.tiles.every((t) => !t.hot)).toBe(true);
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
        // Latest sizes 50 / 50 → even 50% shares; a balanced split is never flagged as skewed.
        expect(result.topPartitionShare).toBeCloseTo(50);
        expect(result.tiles.every((t) => !t.hot)).toBe(true);
        expect(result.skewScore).toBeCloseTo(result.topPartitionShare);
    });
});
