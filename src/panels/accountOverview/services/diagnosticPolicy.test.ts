/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ADVISORY_THRESHOLDS, DIAGNOSTIC_POLICY } from './advisories/core/thresholds';
import { logWindow } from './advisories/fetchers/logs';
import {
    getAccountConsumedRuShape,
    getAutoscaleUtilization,
    getContainerIdlePeak,
    getContainerMergeStoragePeak,
    getContainerPartitionCount,
} from './advisories/fetchers/metrics';
import { DEFAULT_HEALTH_THRESHOLDS, getInventoryMetrics } from './inventoryMetrics';
import { DEFAULT_PARTITION_THRESHOLDS, getPartitionHealth, getPartitionStorageSeries } from './partitionHealth';
import { getRuTrends, getThrottleRate } from './ruTrends';
import { DAY, HOUR, MINUTE, RANGE_CONFIG, type RangeConfig } from './shared';
import { mockClient } from './testFixtures';

afterEach(() => vi.restoreAllMocks());

describe('diagnostic policy compatibility', () => {
    it('preserves the settings defaults', () => {
        expect(DEFAULT_ADVISORY_THRESHOLDS).toEqual({
            partitionSaturationPercent: 90,
            partitionHeadroomPercent: 70,
            throttleRatePercent: 1,
            overProvisioningBandPercent: 30,
            autoscaleMaxPercent: 40,
            autoscaleAvgPercent: 30,
            autoscalePeakToAvgRatio: 5,
            storageGrowthHorizonDays: 180,
            storageSkewBalanceRatio: 0.7,
            indexingUsageRatio: 0.3,
            idlePeakRuPerBucket: 50,
            autoscaleToManualAvgPercent: 66,
            autoscaleToManualPeakToAvgRatio: 1.3,
            serverlessSporadicRatio: 0.1,
            serverlessPeakFloorRuPerSec: 10,
            serverlessPeakCeilingRuPerSec: 5000,
            crossPartitionMinQueries: 50,
            crossPartitionFanoutThreshold: 1.5,
            crossPartitionHighPct: 30,
            crossPartitionMedPct: 10,
            shardKeyStructuralPct: 60,
            shardKeyHighPct: 80,
            ingestionWriteRuPctFloor: 80,
            ingestionThrottleRatePct: 10,
            ingestionHighPct: 20,
            ingestionMinRequests: 1000,
            sharedThroughputMinRequests: 100,
            sharedThroughputPoolThrottlePct: 5,
            sharedThroughputDominancePct: 60,
            sharedThroughputVictimThrottlePct: 5,
            sharedThroughputVictimSharePct: 20,
        });
        expect(DEFAULT_HEALTH_THRESHOLDS).toEqual({ criticalRuPercent: 90, warningRuPercent: 80 });
        expect(DEFAULT_PARTITION_THRESHOLDS).toEqual({
            saturationPercent: 90,
            headroomPercent: 70,
            skewBalanceRatio: 0.7,
            topN: 5,
        });
    });

    it('keeps diagnostic observations independent of chart presets', () => {
        for (const observation of [
            DIAGNOSTIC_POLICY.overProvisioning.observation,
            DIAGNOSTIC_POLICY.storageGrowth.observation,
        ]) {
            expect(observation).toEqual({ timeRange: '7D', windowMs: 30 * DAY, interval: 'PT1H', bucketMs: HOUR });
            expect(observation).not.toBe(RANGE_CONFIG['7D']);
        }
        expect(DIAGNOSTIC_POLICY.partitionSaturation.observation).toEqual({
            timeRange: '7D',
            windowMs: 7 * DAY,
            interval: 'PT1H',
            bucketMs: HOUR,
        });
        expect(DIAGNOSTIC_POLICY.sustainedThrottling.observation).toEqual(RANGE_CONFIG['1H']);
        expect(DIAGNOSTIC_POLICY.sustainedThrottling.observation).not.toBe(RANGE_CONFIG['1H']);
    });

    it('retains the one-day log window', () => {
        const now = Date.UTC(2026, 0, 1);
        expect(logWindow(now)).toEqual({ startTime: new Date(now - DAY), endTime: new Date(now) });
    });
});

interface ObservationCase {
    name: string;
    run: (client: MonitorClient) => Promise<unknown>;
    windowMs: number;
    interval: string;
}

describe.each([
    {
        metric: 'TotalRequestUnits',
        run: (client: MonitorClient) => getAccountConsumedRuShape(client, 'resource'),
        zero: { avgRuPerSec: 0, peakRuPerSec: 0, sampleCount: 1 },
    },
    {
        metric: 'AutoscaledRU',
        run: (client: MonitorClient) => getAutoscaleUtilization(client, 'resource', 'db', 'container', 1000),
        zero: { peakPercent: 0, avgPercent: 0, sampleCount: 1 },
    },
    {
        metric: 'TotalRequests',
        run: (client: MonitorClient) => getThrottleRate(client, 'resource', '7D', 'db', 'container'),
        zero: { ratePercent: 0, totalRequests: 0 },
    },
])('$metric diagnostic failures', ({ metric, run, zero }) => {
    const samples = [{ data: [{ timeStamp: '2026-01-01T00:00:00.000Z', total: 0, maximum: 0, count: 0 }] }];

    it.each([undefined, 'Incomplete metric response'])(
        'rejects per-metric errors with message %s, with or without samples',
        async (errorMessage) => {
            for (const timeseries of [[], samples]) {
                const response = {
                    value: [{ errorCode: 'InternalServerError', errorMessage, timeseries }],
                };
                const client = mockClient({ [metric]: response });
                await expect(run(client)).rejects.toThrow(errorMessage ?? 'InternalServerError');
            }
        },
    );

    it.each([undefined, 'Success'])('preserves observed zeros for success code %s', async (errorCode) => {
        const response = { value: [{ errorCode, timeseries: samples }] };
        const client = mockClient({ [metric]: response });
        expect(await run(client)).toEqual(zero);
    });
});

describe('diagnostic metric observations', () => {
    const cases: ObservationCase[] = [
        {
            name: 'idle',
            run: (client) => getContainerIdlePeak(client, 'resource', 'db', 'container'),
            windowMs: 30 * DAY,
            interval: 'PT5M',
        },
        {
            name: 'serverless',
            run: (client) => getAccountConsumedRuShape(client, 'resource'),
            windowMs: 30 * DAY,
            interval: 'PT1H',
        },
        {
            name: 'autoscale',
            run: (client) => getAutoscaleUtilization(client, 'resource', 'db', 'container', 1000),
            windowMs: 30 * DAY,
            interval: 'PT1H',
        },
        {
            name: 'partition count',
            run: (client) => getContainerPartitionCount(client, 'resource', 'db', 'container'),
            windowMs: 6 * HOUR,
            interval: 'PT5M',
        },
        {
            name: 'merge storage',
            run: (client) => getContainerMergeStoragePeak(client, 'resource', 'db', 'container'),
            windowMs: 6 * HOUR,
            interval: 'PT5M',
        },
    ];

    it.each(cases)('preserves $name window and grain', async ({ run, windowMs, interval }) => {
        const now = Date.UTC(2026, 0, 1);
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const client = mockClient({});
        const list = vi.spyOn(client.metrics, 'list');
        await run(client);
        expect(list).toHaveBeenCalledWith(
            'resource',
            expect.objectContaining({
                timespan: `${new Date(now - windowMs).toISOString()}/${new Date(now).toISOString()}`,
                interval,
            }),
        );
    });

    const custom: RangeConfig = { windowMs: 2 * DAY, interval: 'PT5M', bucketMs: 5 * MINUTE };
    const overrides: { name: string; metric: string; run: (client: MonitorClient) => Promise<unknown> }[] = [
        {
            name: 'RU profile',
            metric: 'NormalizedRUConsumption',
            run: (client) => getRuTrends(client, 'resource', '7D', undefined, undefined, custom),
        },
        {
            name: 'throttle rate',
            metric: 'TotalRequests',
            run: (client) => getThrottleRate(client, 'resource', '7D', 'db', 'container', custom),
        },
        {
            name: 'partition saturation',
            metric: 'NormalizedRUConsumption',
            run: (client) =>
                getPartitionHealth(
                    client,
                    'resource',
                    'ru',
                    '7D',
                    'db',
                    'container',
                    DEFAULT_PARTITION_THRESHOLDS,
                    custom,
                ),
        },
        {
            name: 'partition storage',
            metric: 'PhysicalPartitionSizeInfo',
            run: (client) => getPartitionStorageSeries(client, 'resource', '7D', 'db', 'container', custom),
        },
        {
            name: 'inventory peak',
            metric: 'NormalizedRUConsumption',
            run: (client) =>
                getInventoryMetrics(client, 'resource', '7D', undefined, DEFAULT_HEALTH_THRESHOLDS, custom),
        },
    ];

    it.each(overrides)('uses explicit $name observation rather than chart range', async ({ metric, run }) => {
        const now = Date.UTC(2026, 0, 1);
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const client = mockClient({});
        const list = vi.spyOn(client.metrics, 'list');
        await run(client);
        expect(list).toHaveBeenCalledWith(
            'resource',
            expect.objectContaining({
                metricnames: metric,
                timespan: `${new Date(now - custom.windowMs).toISOString()}/${new Date(now).toISOString()}`,
                interval: custom.interval,
            }),
        );
    });

    it('counts only valid non-null account RU buckets while preserving real zeros', async () => {
        const client = mockClient({
            TotalRequestUnits: {
                value: [
                    {
                        timeseries: [
                            {
                                data: [
                                    { timeStamp: '2026-01-01T00:00:00.000Z', total: null },
                                    { timeStamp: '2026-01-01T01:00:00.000Z', total: 0 },
                                    { timeStamp: '2026-01-01T02:00:00.000Z', total: 3600 },
                                    { timeStamp: 'bad-timestamp', total: 7200 },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getAccountConsumedRuShape(client, 'resource');
        expect(result.sampleCount).toBe(2);
        expect(result.avgRuPerSec).toBeCloseTo(0.5);
        expect(result.peakRuPerSec).toBe(1);
    });

    it('ignores null autoscale samples so they do not manufacture sufficiency', async () => {
        const client = mockClient({
            AutoscaledRU: {
                value: [
                    {
                        timeseries: [
                            {
                                data: [
                                    { timeStamp: '2026-01-01T00:00:00.000Z', maximum: null },
                                    { timeStamp: '2026-01-01T01:00:00.000Z', maximum: 0 },
                                    { timeStamp: '2026-01-01T02:00:00.000Z', maximum: 500 },
                                    { timeStamp: 'bad-timestamp', maximum: 1000 },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        const result = await getAutoscaleUtilization(client, 'resource', 'db', 'container', 1000);
        expect(result.sampleCount).toBe(2);
        expect(result.avgPercent).toBe(25);
        expect(result.peakPercent).toBe(50);
    });

    it('uses the six-hour merge-storage window and folds regional DataUsage peaks', async () => {
        const now = Date.UTC(2026, 0, 1);
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const client = mockClient({
            DataUsage: {
                value: [
                    {
                        timeseries: [
                            {
                                metadatavalues: [
                                    { name: { value: 'DatabaseName' }, value: 'db' },
                                    { name: { value: 'CollectionName' }, value: 'c1' },
                                ],
                                data: [
                                    { timeStamp: new Date(now - HOUR).toISOString(), maximum: 10 },
                                    { timeStamp: new Date(now).toISOString(), maximum: 3 },
                                ],
                            },
                            {
                                metadatavalues: [
                                    { name: { value: 'DatabaseName' }, value: 'db' },
                                    { name: { value: 'CollectionName' }, value: 'c1' },
                                ],
                                data: [{ timeStamp: new Date(now).toISOString(), maximum: 8 }],
                            },
                            {
                                metadatavalues: [
                                    { name: { value: 'DatabaseName' }, value: 'db' },
                                    { name: { value: 'CollectionName' }, value: 'c1' },
                                ],
                                data: [
                                    { timeStamp: new Date(now).toISOString(), maximum: null },
                                    { timeStamp: 'bad-timestamp', maximum: 99 },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
        const list = vi.spyOn(client.metrics, 'list');

        const peak = await getContainerMergeStoragePeak(client, 'resource', 'db', 'c1');

        expect(list).toHaveBeenCalledWith(
            'resource',
            expect.objectContaining({
                metricnames: 'DataUsage',
                aggregation: 'Maximum',
                timespan: `${new Date(now - 6 * HOUR).toISOString()}/${new Date(now).toISOString()}`,
                interval: 'PT5M',
                filter: "CollectionName eq 'c1' and DatabaseName eq 'db'",
            }),
        );
        expect(peak).toBe(10);
    });
});
