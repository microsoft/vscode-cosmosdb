/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeDerivedAdvisories, type DerivedAdvisoryInputs } from '../../../accountOverview/services/advisories';
import { DEFAULT_ADVISORY_THRESHOLDS } from '../../../accountOverview/services/advisories/core/thresholds';
import { OVERVIEW_DEFAULTS } from '../../../accountOverview/services/healthPolicy';
import { deriveRowHealth } from '../../../accountOverview/services/inventoryMetrics';
import { deriveRuSaturationTiles, deriveStorageTiles } from '../../../accountOverview/services/partitionHealth';
import { GIB } from '../../../accountOverview/services/units';
import { readHealthThresholds, readPartitionThresholds } from './thresholds';

const mocks = vi.hoisted(() => ({ get: vi.fn<(key: string) => number | undefined>() }));
vi.mock('vscode', () => ({
    workspace: { getConfiguration: vi.fn(() => ({ get: mocks.get })) },
}));

beforeEach(() => mocks.get.mockReset());

describe('user Health/view thresholds', () => {
    it('reads only the six public controls and preserves their defaults', () => {
        expect(readHealthThresholds()).toEqual(OVERVIEW_DEFAULTS.health);
        expect(readPartitionThresholds()).toEqual(OVERVIEW_DEFAULTS.partition);
        expect(mocks.get.mock.calls.map(([key]) => key).sort()).toEqual([
            'health.criticalRuPercent',
            'health.partitionHeadroomPercent',
            'health.partitionSaturationPercent',
            'health.storageSkewBalanceRatio',
            'health.warningRuPercent',
            'partition.topN',
        ]);
    });

    it('retains existing zero handling and ranked-list rounding', () => {
        const values: Record<string, number> = {
            'health.criticalRuPercent': 0,
            'health.warningRuPercent': 0,
            'health.partitionSaturationPercent': 0,
            'health.partitionHeadroomPercent': 0,
            'health.storageSkewBalanceRatio': 0,
            'partition.topN': 2.9,
        };
        mocks.get.mockImplementation((key: string) => values[key]);
        expect(readHealthThresholds()).toEqual({ criticalRuPercent: 0, warningRuPercent: 0 });
        expect(readPartitionThresholds()).toEqual({ ...OVERVIEW_DEFAULTS.partition, topN: 2 });
    });

    it('ignores the former advisories keys even when explicitly configured', () => {
        const values: Record<string, number> = {
            'advisories.partitionSaturationPercent': 99,
            'advisories.partitionHeadroomPercent': 10,
            'advisories.storageSkewBalanceRatio': 0.1,
        };
        mocks.get.mockImplementation((key: string) => values[key]);
        expect(readPartitionThresholds()).toEqual(OVERVIEW_DEFAULTS.partition);
        expect(mocks.get.mock.calls.some(([key]) => key.startsWith('advisories.'))).toBe(false);
    });

    it('changes Health/heatmap flags without changing Derived findings or policy', () => {
        const values: Record<string, number> = {
            'health.criticalRuPercent': 99,
            'health.warningRuPercent': 98,
            'health.partitionSaturationPercent': 99,
            'health.partitionHeadroomPercent': 10,
            'health.storageSkewBalanceRatio': 0.1,
            'partition.topN': 2,
            'advisories.throttleRatePercent': 100,
            'advisories.indexingUsageRatio': 999,
        };
        const input: DerivedAdvisoryInputs = {
            weeklyRuPercents: [],
            hasManualThroughput: false,
            partitions: [
                {
                    databaseId: 'db',
                    containerId: 'container',
                    maxP99: 95,
                    minP99: 40,
                    partitionCount: 2,
                    throttleRatePercent: 2,
                    totalRequests: 10_000,
                    throughputMode: 'dedicated',
                },
            ],
            storage: [],
            storageSkew: [
                {
                    databaseId: 'db',
                    containerId: 'container',
                    partitions: [
                        { partitionId: '0', samples: [{ timestamp: 1, bytes: 10 * GIB }] },
                        { partitionId: '1', samples: [{ timestamp: 1, bytes: 2 * GIB }] },
                    ],
                },
            ],
            indexing: [],
        };
        const policyBefore = structuredClone(DEFAULT_ADVISORY_THRESHOLDS);
        const before = computeDerivedAdvisories(input, DEFAULT_ADVISORY_THRESHOLDS);
        mocks.get.mockImplementation((key: string) => values[key]);
        const health = readHealthThresholds();
        const partition = readPartitionThresholds();
        expect(deriveRowHealth({ peakRuPercent: 95 }, health)).toBe('Healthy');
        expect(deriveRowHealth({ peakRuPercent: 95 }, OVERVIEW_DEFAULTS.health)).toBe('Critical');
        const ru = new Map([
            ['0', 95],
            ['1', 40],
        ]);
        expect(deriveRuSaturationTiles(ru, partition).hotPartition).toBe(false);
        expect(deriveRuSaturationTiles(ru, OVERVIEW_DEFAULTS.partition).hotPartition).toBe(true);
        const storage = new Map([
            ['0', 10 * GIB],
            ['1', 2 * GIB],
        ]);
        expect(deriveStorageTiles(storage, partition).tiles.every((tile) => !tile.hot)).toBe(true);
        expect(deriveStorageTiles(storage, OVERVIEW_DEFAULTS.partition).tiles[0].hot).toBe(true);
        expect(computeDerivedAdvisories(input, DEFAULT_ADVISORY_THRESHOLDS)).toEqual(before);
        expect(before.map(({ rule }) => rule)).toEqual(expect.arrayContaining(['HotPartitionRisk', 'StorageSkewRisk']));
        expect(DEFAULT_ADVISORY_THRESHOLDS).toEqual(policyBefore);
    });
});
