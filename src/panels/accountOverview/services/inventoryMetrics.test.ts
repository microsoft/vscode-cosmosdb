/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_HEALTH_THRESHOLDS,
    deriveAccountHealth,
    deriveRowHealth,
    getInventoryMetrics,
    type HealthThresholds,
} from './inventoryMetrics';
import { containerKey } from './shared';
import { dims, GB, iso, mockClient, type Point } from './testFixtures';

const thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS;

describe('deriveRowHealth', () => {
    it('is Healthy when nothing crosses a threshold', () => {
        expect(deriveRowHealth({ peakRuPercent: 10, throttled: false }, thresholds)).toBe('Healthy');
    });

    it('is Healthy when metrics are missing', () => {
        expect(deriveRowHealth({ peakRuPercent: undefined, throttled: false }, thresholds)).toBe('Healthy');
    });

    it('flips to Needs Attention when peak crosses the warning threshold', () => {
        expect(deriveRowHealth({ peakRuPercent: 80, throttled: false }, thresholds)).toBe('Needs Attention');
    });

    it('flips to Critical when peak crosses the critical threshold', () => {
        expect(deriveRowHealth({ peakRuPercent: 90, throttled: false }, thresholds)).toBe('Critical');
    });

    it('is Critical when throttled regardless of peak', () => {
        expect(deriveRowHealth({ peakRuPercent: 1, throttled: true }, thresholds)).toBe('Critical');
    });
});

describe('deriveAccountHealth', () => {
    it('is Healthy when provisioning succeeded and nothing is throttling', () => {
        expect(deriveAccountHealth('Succeeded', false)).toBe('Healthy');
    });

    it('is Critical when sustained throttling is detected', () => {
        expect(deriveAccountHealth('Succeeded', true)).toBe('Critical');
    });

    it('is Needs Attention while the account is mid-operation', () => {
        expect(deriveAccountHealth('Updating', false)).toBe('Needs Attention');
    });

    it('is Critical for failed/unknown provisioning states', () => {
        expect(deriveAccountHealth('Failed', false)).toBe('Critical');
    });

    it('is Healthy when provisioning state is unknown and no throttling', () => {
        expect(deriveAccountHealth(undefined, false)).toBe('Healthy');
    });
});

// ─── getInventoryMetrics with a mocked MonitorClient ────────────────────────

describe('getInventoryMetrics', () => {
    const base = Date.now();
    const minute = 60 * 1000;

    it('returns available: false when storage and RU series are both empty', async () => {
        const client = mockClient({});
        const result = await getInventoryMetrics(client, '/sub/acct', '24H', 'Succeeded', thresholds);
        expect(result.available).toBe(false);
        expect(result.metrics).toEqual({});
        expect(result.accountHealth).toBe('Healthy');
    });

    it('computes storage, growth, peak, and health per container', async () => {
        // c1: DataUsage 100 → 300 (growth 200), Index 50 → storage 350, peak 95 → Critical
        // c2: peak 85 → Needs Attention
        // c3: peak 20, storage growth 12 GB → Healthy (storage growth no longer feeds row health)
        // c4: peak 10, small growth → Healthy
        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [
                                    { timeStamp: iso(base - 6 * minute), maximum: 100 },
                                    { timeStamp: iso(base), maximum: 300 },
                                ],
                            },
                            {
                                metadatavalues: dims('db', 'c3'),
                                data: [
                                    { timeStamp: iso(base - 6 * minute), maximum: 0 },
                                    { timeStamp: iso(base), maximum: 12 * GB },
                                ],
                            },
                            {
                                metadatavalues: dims('db', 'c4'),
                                data: [
                                    { timeStamp: iso(base - 6 * minute), maximum: 10 },
                                    { timeStamp: iso(base), maximum: 20 },
                                ],
                            },
                        ],
                    },
                ],
            },
            IndexUsage: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [{ timeStamp: iso(base), maximum: 50 }],
                            },
                        ],
                    },
                ],
            },
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'c1'), data: [{ timeStamp: iso(base), maximum: 95 }] },
                            { metadatavalues: dims('db', 'c2'), data: [{ timeStamp: iso(base), maximum: 85 }] },
                            { metadatavalues: dims('db', 'c3'), data: [{ timeStamp: iso(base), maximum: 20 }] },
                            { metadatavalues: dims('db', 'c4'), data: [{ timeStamp: iso(base), maximum: 10 }] },
                        ],
                    },
                ],
            },
        });

        const result = await getInventoryMetrics(client, '/sub/acct', '24H', 'Succeeded', thresholds);
        expect(result.available).toBe(true);

        const c1 = result.metrics[containerKey('db', 'c1')];
        expect(c1.storageBytes).toBe(350);
        expect(c1.storageGrowthBytes).toBe(200);
        expect(c1.peakRuPercent).toBe(95);
        expect(c1.health).toBe('Critical');

        expect(result.metrics[containerKey('db', 'c2')].health).toBe('Needs Attention');
        expect(result.metrics[containerKey('db', 'c3')].storageGrowthBytes).toBe(12 * GB);
        expect(result.metrics[containerKey('db', 'c3')].health).toBe('Healthy');
        expect(result.metrics[containerKey('db', 'c4')].health).toBe('Healthy');

        // No throttling reported → account health tracks provisioning only.
        expect(result.accountHealth).toBe('Healthy');
    });

    it('marks a container Critical and the account Critical on sustained throttling', async () => {
        const throttleData: Point[] = [];
        const okData: Point[] = [];
        for (let i = 0; i < 6; i++) {
            throttleData.push({ timeStamp: iso(base - (5 - i) * minute), total: 100 });
            okData.push({ timeStamp: iso(base - (5 - i) * minute), total: 1 });
        }

        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'hot'), data: [{ timeStamp: iso(base), maximum: 100 }] },
                        ],
                    },
                ],
            },
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'hot'), data: [{ timeStamp: iso(base), maximum: 30 }] },
                        ],
                    },
                ],
            },
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            { metadatavalues: dims('db', 'hot', '429'), data: throttleData },
                            { metadatavalues: dims('db', 'hot', '200'), data: okData },
                        ],
                    },
                ],
            },
        });

        const result = await getInventoryMetrics(client, '/sub/acct', '1H', 'Succeeded', thresholds);
        const hot = result.metrics[containerKey('db', 'hot')];
        expect(hot.throttled).toBe(true);
        expect(hot.health).toBe('Critical');
        expect(result.accountHealth).toBe('Critical');
    });

    it('surfaces document count and downsampled sparklines per container', async () => {
        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [
                                    { timeStamp: iso(base - 2 * minute), maximum: 100 },
                                    { timeStamp: iso(base - minute), maximum: 200 },
                                    { timeStamp: iso(base), maximum: 300 },
                                ],
                            },
                        ],
                    },
                ],
            },
            NormalizedRUConsumption: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [
                                    { timeStamp: iso(base - minute), maximum: 40 },
                                    { timeStamp: iso(base), maximum: 60 },
                                ],
                            },
                        ],
                    },
                ],
            },
            DocumentCountV2: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: dims('db', 'c1'),
                                data: [
                                    { timeStamp: iso(base - minute), maximum: 1200 },
                                    { timeStamp: iso(base), maximum: 1500 },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getInventoryMetrics(client, '/sub/acct', '24H', 'Succeeded', thresholds);
        const c1 = result.metrics[containerKey('db', 'c1')];
        expect(c1.documentCount).toBe(1500);
        expect(c1.storageSparkline).toEqual([100, 200, 300]);
        expect(c1.ruSparkline).toEqual([40, 60]);
    });
});
