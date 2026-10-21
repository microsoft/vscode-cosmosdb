/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import type * as InventoryModule from '../inventory';
import type * as RuTrendsModule from '../ruTrends';
import type * as EngineModule from './engine';
import type * as MetricsModule from './fetchers/metrics';

vi.mock('../inventory', () => ({
    getSqlInventoryDetails: vi.fn(),
}));

vi.mock('../inventoryMetrics', () => ({
    getInventoryMetrics: vi.fn(),
}));

vi.mock('../partitionHealth', () => ({
    getPartitionHealth: vi.fn(),
    getPartitionStorageSeries: vi.fn(),
}));

vi.mock('../ruTrends', async (importOriginal) => ({
    ...(await importOriginal<typeof RuTrendsModule>()),
    getRuTrends: vi.fn(),
    getThrottleRate: vi.fn(),
}));

vi.mock('./engine', () => ({
    computeDerivedAdvisories: vi.fn(),
}));

vi.mock('./fetchers/logs', () => ({
    fetchCrossPartitionShapes: vi.fn(),
    fetchSharedThroughputTraffic: vi.fn(),
    fetchUncontrolledIngestion: vi.fn(),
    logWindow: vi.fn(() => ({ startTime: new Date(0), endTime: new Date(1) })),
    probeCdbLogs: vi.fn(),
}));

vi.mock('./fetchers/metrics', () => ({
    getAccountConsumedRuShape: vi.fn(),
    getAutoscaleUtilization: vi.fn(),
    getContainerIdlePeak: vi.fn(),
    getContainerMergeStoragePeak: vi.fn(),
    getContainerPartitionCount: vi.fn(),
}));

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { MonitorClient, type Response as MetricsResponse } from '@azure/arm-monitor';
import { getSqlInventoryDetails } from '../inventory';
import { getInventoryMetrics } from '../inventoryMetrics';
import { getPartitionHealth, getPartitionStorageSeries } from '../partitionHealth';
import { getRuTrends, getThrottleRate } from '../ruTrends';
import { GB, pagedItems } from '../testFixtures';
import { collectDerivedAdvisories } from './collect';
import { DEFAULT_ADVISORY_THRESHOLDS } from './core/thresholds';
import { type DerivedAdvisory, type DerivedAdvisoryRule } from './core/types';
import { computeDerivedAdvisories } from './engine';
import {
    fetchCrossPartitionShapes,
    fetchSharedThroughputTraffic,
    fetchUncontrolledIngestion,
    probeCdbLogs,
} from './fetchers/logs';
import {
    getAccountConsumedRuShape,
    getAutoscaleUtilization,
    getContainerIdlePeak,
    getContainerMergeStoragePeak,
    getContainerPartitionCount,
} from './fetchers/metrics';

afterEach(() => {
    vi.resetAllMocks();
});

function advisory(rule: DerivedAdvisoryRule, scope?: string): DerivedAdvisory {
    return {
        id: `${rule}:${scope ?? 'account'}`,
        rule,
        severity: 'Low',
        title: rule,
        rationale: rule,
        suggestedAction: rule,
        thresholdReference: rule,
        scope,
    };
}

function params(overrides: Partial<Parameters<typeof collectDerivedAdvisories>[0]> = {}) {
    return {
        monitorClient: {
            metrics: { list: vi.fn(async () => ({ value: [] })) },
        } as unknown as MonitorClient,
        cosmosClient: {
            databaseAccounts: {
                get: vi.fn(async () => ({ systemData: { createdAt: '2026-01-01T00:00:00.000Z' } })),
            },
        } as unknown as CosmosDBManagementClient,
        accountId: '/subscriptions/test/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/acct',
        resourceGroup: 'rg',
        accountName: 'acct',
        isServerless: false,
        healthThresholds: { criticalRuPercent: 90, warningRuPercent: 80 },
        partitionThresholds: { saturationPercent: 90, headroomPercent: 70, skewBalanceRatio: 0.7, topN: 5 },
        advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
        accountConfig: {
            accountName: 'acct-prod',
            regionCount: 2,
            multiRegionWritesEnabled: false,
            writeRegionCount: 1,
            api: API.Core,
        },
        logsClient: { queryResource: vi.fn() },
        ...overrides,
    };
}

describe('collectDerivedAdvisories parity wiring', () => {
    it.each([
        { paths: [], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/_etag/?'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/"_etag"/?'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/_etag/?', '/payload/*'], indexUsageBytes: 50, dataUsageBytes: 100, fires: false },
        { paths: ['/"_etag"/?', '/payload/*'], indexUsageBytes: 50, dataUsageBytes: 100, fires: false },
        { paths: ['/payload/_etag/?'], indexUsageBytes: 50, dataUsageBytes: 100, fires: false },
        { paths: ['/payload/"_etag"/?'], indexUsageBytes: 50, dataUsageBytes: 100, fires: false },
        { paths: ['/_etag/*'], indexUsageBytes: 50, dataUsageBytes: 100, fires: false },
        { paths: ['/_etag/?'], indexUsageBytes: 20, dataUsageBytes: 100, fires: false },
        { paths: ['/_etag/?'], indexUsageBytes: 30, dataUsageBytes: 100, fires: false },
        { paths: ['/_etag/?'], indexUsageBytes: undefined, dataUsageBytes: 100, fires: false },
        { paths: ['/_etag/?'], indexUsageBytes: 50, dataUsageBytes: undefined, fires: false },
        { paths: ['/_etag/?'], indexUsageBytes: 50, dataUsageBytes: 0, fires: false },
        { paths: ['/_etag/?'], indexUsageBytes: 50, dataUsageBytes: -1, fires: false },
        { paths: ['/_etag/?'], indexUsageBytes: -1, dataUsageBytes: 100, fires: false },
    ])(
        'evaluates indexing exclusions $paths with index=$indexUsageBytes, data=$dataUsageBytes: fires=$fires',
        async ({ paths, indexUsageBytes, dataUsageBytes, fires }) => {
            const inventory = await vi.importActual<typeof InventoryModule>('../inventory');
            const engine = await vi.importActual<typeof EngineModule>('./engine');
            vi.mocked(getSqlInventoryDetails).mockImplementation(inventory.getSqlInventoryDetails);
            vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
            const indexingPolicy = {
                indexingMode: 'consistent',
                includedPaths: [{ path: '/*' }],
                excludedPaths: paths.map((path) => ({ path })),
            };
            const originalPolicy = structuredClone(indexingPolicy);
            const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
            vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({});
            vi.spyOn(cosmosClient.sqlResources, 'listSqlDatabases').mockImplementation(() =>
                pagedItems([{ resource: { id: 'db' } }]),
            );
            vi.spyOn(cosmosClient.sqlResources, 'listSqlContainers').mockImplementation(() =>
                pagedItems([{ resource: { id: 'events', indexingPolicy } }]),
            );
            vi.mocked(getThrottleRate).mockResolvedValue({ ratePercent: 0, totalRequests: 0 });
            vi.mocked(getInventoryMetrics).mockResolvedValue({
                available: true,
                metrics: {
                    'db/events': {
                        databaseId: 'db',
                        containerId: 'events',
                        storage: {
                            data:
                                dataUsageBytes === undefined
                                    ? { status: 'unavailable', reason: 'noData' }
                                    : { status: 'available', bytes: dataUsageBytes, timestamp: 0 },
                            index:
                                indexUsageBytes === undefined
                                    ? { status: 'unavailable', reason: 'noData' }
                                    : { status: 'available', bytes: indexUsageBytes, timestamp: 0 },
                        },
                        throttled: false,
                        health: 'Healthy',
                    },
                },
                generatedAt: 0,
            });

            const result = await collectDerivedAdvisories(
                params({ cosmosClient, isServerless: true, logsClient: undefined }),
            );

            expect(result.advisories.filter((item) => item.rule === 'IndexingCostRisk')).toHaveLength(fires ? 1 : 0);
            expect(vi.mocked(getInventoryMetrics).mock.calls[0][5]).toBe(true);
            expect(getRuTrends).not.toHaveBeenCalled();
            expect(getPartitionHealth).not.toHaveBeenCalled();
            const collectedInventory = await vi.mocked(getSqlInventoryDetails).mock.results[0].value;
            expect(collectedInventory.rows[0].excludedPathCount).toBe(paths.length);
            expect(indexingPolicy).toEqual(originalPolicy);

            vi.mocked(getInventoryMetrics).mockResolvedValue({
                available: false,
                reason: 'noData',
                metrics: {},
                generatedAt: 0,
            });
            const unavailable = await collectDerivedAdvisories(
                params({ cosmosClient, isServerless: true, logsClient: undefined }),
            );
            expect(unavailable.advisories.some((item) => item.rule === 'IndexingCostRisk')).toBe(false);
            expect(unavailable.metricSource.failures).toContainEqual({
                rule: 'IndexingCostRisk',
                reason: 'noData',
                scope: undefined,
            });
        },
    );

    it.each([
        'complete',
        'missing idle',
        'missing partition count',
        'missing storage',
        'zero storage',
        'access denied',
    ] as const)(
        'collects idle and merge metrics for all twelve active containers without wildcard truncation: %s',
        async (scenario) => {
            const metrics = await vi.importActual<typeof MetricsModule>('./fetchers/metrics');
            const { computeDerivedAdvisories: evaluate } = await vi.importActual<{
                computeDerivedAdvisories: typeof computeDerivedAdvisories;
            }>('./engine');
            vi.mocked(getContainerIdlePeak).mockImplementation(metrics.getContainerIdlePeak);
            vi.mocked(getContainerPartitionCount).mockImplementation(metrics.getContainerPartitionCount);
            vi.mocked(getContainerMergeStoragePeak).mockImplementation(metrics.getContainerMergeStoragePeak);
            vi.mocked(computeDerivedAdvisories).mockImplementation(evaluate);
            const rows = Array.from({ length: 12 }, (_, index) => ({
                databaseId: `db${Math.floor(index / 6)}`,
                containerId: `c${index % 6}`,
                throughputMode: 'dedicated' as const,
                throughputRU: 1000,
                offerLevel: 'container' as const,
                offerThroughputMode: 'manual' as const,
                resourceCreatedAt: '2020-01-01T00:00:00.000Z',
                partitionKeyPaths: [],
                indexingMode: 'consistent',
                excludedPathCount: 0,
                userExcludedPathCount: 0,
                compositeIndexCount: 0,
                health: 'Healthy' as const,
            }));
            vi.mocked(getSqlInventoryDetails).mockResolvedValue({
                rows,
                offers: rows,
                databases: [...new Set(rows.map((row) => row.databaseId))],
            });
            vi.mocked(getRuTrends).mockResolvedValue({
                available: false,
                points: [],
                provisionedPercent: 100,
                timeRange: '7D',
                generatedAt: 0,
            });
            vi.mocked(getInventoryMetrics).mockResolvedValue({
                available: false,
                metrics: {},
                generatedAt: 0,
            });
            vi.mocked(getPartitionHealth).mockRejectedValue(new Error('unavailable'));
            vi.mocked(getPartitionStorageSeries).mockRejectedValue(new Error('unavailable'));
            vi.mocked(getThrottleRate).mockResolvedValue({ ratePercent: 0, totalRequests: 1000 });
            vi.mocked(getAccountConsumedRuShape).mockResolvedValue({ avgRuPerSec: 0, peakRuPerSec: 0, sampleCount: 0 });
            const monitorClient = new MonitorClient({ getToken: async () => null }, 'sub');
            let inFlight = 0;
            let peakConcurrency = 0;
            const list = vi
                .spyOn(monitorClient.metrics, 'list')
                .mockImplementation(async (_resource, options): Promise<MetricsResponse> => {
                    inFlight++;
                    peakConcurrency = Math.max(peakConcurrency, inFlight);
                    await Promise.resolve();
                    inFlight--;
                    const targets = options?.filter?.includes("eq '*'")
                        ? rows.slice(0, 10)
                        : rows.filter(
                              (row) =>
                                  options?.filter?.includes(`DatabaseName eq '${row.databaseId}'`) &&
                                  options.filter.includes(`CollectionName eq '${row.containerId}'`),
                          );
                    const metricName = options?.metricnames ?? '';
                    const affected = targets.length === 1 && targets[0] === rows[0];
                    if (affected && scenario === 'access denied') {
                        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
                    }
                    const missing =
                        affected &&
                        ((scenario === 'missing idle' && metricName === 'TotalRequestUnits') ||
                            (scenario === 'missing partition count' && metricName === 'PhysicalPartitionCount') ||
                            (scenario === 'missing storage' && metricName === 'DataUsage'));
                    return {
                        timespan: options?.timespan ?? '',
                        value: [
                            {
                                id: metricName,
                                type: 'Microsoft.Insights/metrics',
                                name: { value: metricName },
                                unit: 'Count',
                                timeseries: (missing ? [] : targets).map((row) => ({
                                    metadatavalues: [
                                        { name: { value: 'DatabaseName' }, value: row.databaseId },
                                        { name: { value: 'CollectionName' }, value: row.containerId },
                                    ],
                                    data: [
                                        {
                                            timeStamp: new Date(),
                                            ...(metricName === 'TotalRequestUnits'
                                                ? { total: 1000 }
                                                : {
                                                      maximum:
                                                          metricName === 'PhysicalPartitionCount'
                                                              ? 4
                                                              : affected && scenario === 'zero storage'
                                                                ? 0
                                                                : GB,
                                                  }),
                                        },
                                    ],
                                })),
                            },
                        ],
                    };
                });

            const result = await collectDerivedAdvisories(params({ monitorClient, logsClient: undefined }));
            const inputs = vi.mocked(computeDerivedAdvisories).mock.calls[0][0];
            const missingIdle = scenario === 'missing idle' || scenario === 'access denied';
            const missingMerge =
                scenario === 'missing partition count' ||
                scenario === 'missing storage' ||
                scenario === 'access denied';
            const idleRows = missingIdle ? rows.slice(1) : rows;
            const mergeRows = missingMerge ? rows.slice(1) : rows;
            const metricFailures = result.metricSource.failures.filter(
                (failure) => failure.rule === 'IdleContainer' || failure.rule === 'PartitionMergeCandidate',
            );

            expect.soft(result.advisories.filter((item) => item.rule === 'IdleContainer')).toEqual([]);
            expect.soft(inputs.idleContainers).toHaveLength(idleRows.length);
            expect.soft(inputs.idleContainers?.every((item) => item.peakRuPerBucket === 1000)).toBe(true);
            expect.soft(inputs.partitionMerges).toHaveLength(mergeRows.length);
            expect
                .soft(result.advisories.filter((item) => item.rule === 'PartitionMergeCandidate'))
                .toHaveLength(mergeRows.length);
            for (const row of mergeRows) {
                expect.soft(inputs.partitionMerges).toContainEqual({
                    databaseId: row.databaseId,
                    containerId: row.containerId,
                    actualPartitions: 4,
                    provisionedRu: 1000,
                    dataUsageBytes: scenario === 'zero storage' && row === rows[0] ? 0 : GB,
                });
            }
            expect.soft(list).toHaveBeenCalledTimes(rows.length * 3);
            expect.soft(peakConcurrency).toBeGreaterThan(1);
            expect.soft(peakConcurrency).toBeLessThanOrEqual(5);
            expect.soft(list.mock.calls.every(([, options]) => !options?.filter?.includes("eq '*'"))).toBe(true);
            expect.soft(metricFailures).toEqual([
                ...(missingIdle
                    ? [
                          {
                              rule: 'IdleContainer',
                              scope: 'db0/c0',
                              reason: scenario === 'access denied' ? 'rbac' : 'noData',
                          },
                      ]
                    : []),
                ...(missingMerge
                    ? [
                          {
                              rule: 'PartitionMergeCandidate',
                              scope: 'db0/c0',
                              reason: scenario === 'access denied' ? 'rbac' : 'noData',
                          },
                      ]
                    : []),
            ]);
        },
    );

    it('evaluates more than ten dedicated offers and excludes a known-young container in the real engine', async () => {
        const { computeDerivedAdvisories: evaluate } = await vi.importActual<{
            computeDerivedAdvisories: typeof computeDerivedAdvisories;
        }>('./engine');
        vi.mocked(computeDerivedAdvisories).mockImplementation(evaluate);
        const rows = Array.from({ length: 12 }, (_, index) => ({
            databaseId: 'db',
            containerId: `c${index}`,
            throughputMode: 'dedicated' as const,
            throughputRU: 1000,
            offerLevel: 'container' as const,
            offerThroughputMode: 'manual' as const,
            resourceCreatedAt: index === 0 ? undefined : '2020-01-01T00:00:00.000Z',
            partitionKeyPaths: [],
            indexingMode: 'consistent',
            excludedPathCount: 0,
            userExcludedPathCount: 0,
            compositeIndexCount: 0,
            health: 'Healthy' as const,
        }));
        vi.mocked(getSqlInventoryDetails).mockResolvedValue({
            rows,
            offers: rows,
            databases: [...new Set(rows.map((row) => row.databaseId))],
        });
        vi.mocked(getRuTrends).mockResolvedValue({
            available: true,
            points: Array.from({ length: 24 }, (_, index) => ({ timestamp: index, ruPercent: 10, throttled: false })),
            provisionedPercent: 100,
            peakPercent: 10,
            timeRange: '7D',
            generatedAt: 0,
        });
        vi.mocked(getContainerIdlePeak).mockResolvedValue(1000);
        vi.mocked(getInventoryMetrics).mockResolvedValue({
            available: false,
            metrics: {},
            generatedAt: 0,
        });
        vi.mocked(getPartitionHealth).mockRejectedValue(new Error('unavailable'));
        vi.mocked(getPartitionStorageSeries).mockRejectedValue(new Error('unavailable'));
        vi.mocked(getThrottleRate).mockResolvedValue({ ratePercent: 0, totalRequests: 1000 });
        vi.mocked(getContainerPartitionCount).mockResolvedValue(undefined);
        vi.mocked(getContainerMergeStoragePeak).mockResolvedValue(undefined);
        vi.mocked(getAccountConsumedRuShape).mockResolvedValue({ avgRuPerSec: 0, peakRuPerSec: 0, sampleCount: 0 });
        const monitorClient = new MonitorClient({ getToken: async () => null }, 'sub');
        vi.spyOn(monitorClient.activityLogs, 'list').mockImplementation(() =>
            pagedItems([
                {
                    operationName: { value: 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/write' },
                    eventTimestamp: new Date(Date.now() - 3_600_000),
                },
            ]),
        );
        const result = await collectDerivedAdvisories(params({ monitorClient, logsClient: undefined }));
        expect(getRuTrends).toHaveBeenCalledTimes(12);
        const sizing = result.advisories.filter((item) => item.rule === 'OverProvisioning');
        expect(sizing).toHaveLength(11);
        expect(sizing.some((item) => item.scope === 'db/c0')).toBe(false);
        expect(sizing.some((item) => item.scope === 'db/c11')).toBe(true);
    });

    it('uses dedicated offers for container checks, includes serverless throttling, and counts scope RU once per offer', async () => {
        vi.mocked(getSqlInventoryDetails).mockResolvedValue({
            databases: ['db-shared', 'db-manual', 'db-auto', 'db-sls'],
            rows: [
                {
                    databaseId: 'db-shared',
                    containerId: 'shared-child',
                    throughputMode: 'autoscale',
                    throughputRU: 4000,
                    offerLevel: 'database',
                    offerThroughputMode: 'autoscale',
                    resourceCreatedAt: '2026-01-10T00:00:00.000Z',
                    partitionKeyPaths: [],
                    indexingMode: 'consistent',
                    excludedPathCount: 0,
                    userExcludedPathCount: 0,
                    compositeIndexCount: 0,
                    health: 'Healthy',
                },
                {
                    databaseId: 'db-manual',
                    containerId: 'manual-c',
                    throughputMode: 'dedicated',
                    throughputRU: 1000,
                    offerLevel: 'container',
                    offerThroughputMode: 'manual',
                    resourceCreatedAt: '2026-01-11T00:00:00.000Z',
                    partitionKeyPaths: [],
                    indexingMode: 'consistent',
                    excludedPathCount: 0,
                    userExcludedPathCount: 0,
                    compositeIndexCount: 0,
                    health: 'Healthy',
                },
                {
                    databaseId: 'db-auto',
                    containerId: 'auto-c',
                    throughputMode: 'autoscale',
                    throughputRU: 5000,
                    offerLevel: 'container',
                    offerThroughputMode: 'autoscale',
                    resourceCreatedAt: '2026-01-12T00:00:00.000Z',
                    partitionKeyPaths: [],
                    indexingMode: 'consistent',
                    excludedPathCount: 0,
                    userExcludedPathCount: 0,
                    compositeIndexCount: 0,
                    health: 'Healthy',
                },
                {
                    databaseId: 'db-sls',
                    containerId: 'serverless-c',
                    throughputMode: 'serverless',
                    offerLevel: 'none',
                    offerThroughputMode: 'serverless',
                    resourceCreatedAt: '2026-01-13T00:00:00.000Z',
                    partitionKeyPaths: [],
                    indexingMode: 'consistent',
                    excludedPathCount: 0,
                    userExcludedPathCount: 0,
                    compositeIndexCount: 0,
                    health: 'Healthy',
                },
            ],
            offers: [
                {
                    databaseId: 'db-shared',
                    offerLevel: 'database',
                    throughputMode: 'autoscale',
                    offerThroughputMode: 'autoscale',
                    throughputRU: 4000,
                },
                {
                    databaseId: 'db-manual',
                    containerId: 'manual-c',
                    offerLevel: 'container',
                    throughputMode: 'dedicated',
                    offerThroughputMode: 'manual',
                    throughputRU: 1000,
                },
                {
                    databaseId: 'db-auto',
                    containerId: 'auto-c',
                    offerLevel: 'container',
                    throughputMode: 'autoscale',
                    offerThroughputMode: 'autoscale',
                    throughputRU: 5000,
                },
            ],
        });
        vi.mocked(getRuTrends).mockResolvedValue({
            available: true,
            points: [{ timestamp: 1, ruPercent: 10, throttled: false }],
            peakPercent: 10,
            provisionedPercent: 100,
            timeRange: '7D',
            generatedAt: 1,
        });
        vi.mocked(getContainerIdlePeak).mockImplementation(async (_client, _resource, databaseId) =>
            databaseId === 'db-manual' ? 0 : 20,
        );
        vi.mocked(getInventoryMetrics).mockResolvedValue({
            available: true,
            metrics: {},
            generatedAt: 1,
        });
        vi.mocked(getPartitionHealth).mockResolvedValue({
            available: true,
            mode: 'ru',
            databaseId: 'db-manual',
            containerId: 'manual-c',
            tiles: [],
            skewScore: 0,
            topPartitionShare: 95,
            maxSaturationPercent: 95,
            minSaturationPercent: 50,
            partitionCount: 2,
            topN: 5,
            generatedAt: 1,
        });
        vi.mocked(getThrottleRate).mockImplementation(async (_client, _resource, _range, databaseId, containerId) => ({
            ratePercent: containerId === 'serverless-c' ? 6 : 2,
            totalRequests: databaseId === 'db-sls' ? 5000 : 3000,
        }));
        vi.mocked(getPartitionStorageSeries).mockResolvedValue({
            available: true,
            databaseId: 'db-manual',
            containerId: 'manual-c',
            partitions: [{ partitionId: '0', samples: [{ timestamp: 1, bytes: 10 }] }],
            generatedAt: 1,
        });
        vi.mocked(getContainerPartitionCount).mockImplementation(async (_client, _resource, databaseId) =>
            databaseId === 'db-manual' ? 3 : 4,
        );
        vi.mocked(getAutoscaleUtilization).mockResolvedValue({
            peakPercent: 25,
            avgPercent: 15,
            sampleCount: 30,
        });
        vi.mocked(getAccountConsumedRuShape).mockResolvedValue({
            avgRuPerSec: 5,
            peakRuPerSec: 100,
            sampleCount: 50,
        });
        vi.mocked(probeCdbLogs).mockResolvedValue({ available: true });
        vi.mocked(fetchCrossPartitionShapes).mockImplementation(async (_logs, _account, databaseId, containerId) => ({
            databaseId,
            containerId,
            shapes: [],
        }));
        vi.mocked(fetchUncontrolledIngestion).mockImplementation(async (_logs, _account, databaseId, containerId) => ({
            databaseId,
            containerId,
            writeRu: 10,
            totalRu: 20,
            totalRequests: 1000,
            throttledRequests: 10,
            burstFactor: 2,
        }));
        vi.mocked(fetchSharedThroughputTraffic).mockImplementation(async (_logs, _account, databaseId, sharedRu) => ({
            databaseId,
            sharedRu,
            collections: [],
        }));
        vi.mocked(computeDerivedAdvisories).mockReturnValue([]);

        vi.mocked(getContainerMergeStoragePeak).mockImplementation(async (_client, _resource, databaseId) =>
            databaseId === 'db-manual' ? 100 : 200,
        );

        const result = await collectDerivedAdvisories(params());
        const inputs = vi.mocked(computeDerivedAdvisories).mock.calls[0][0];

        expect(inputs.manualThroughput).toEqual([
            expect.objectContaining({ databaseId: 'db-manual', containerId: 'manual-c', provisionedRu: 1000 }),
        ]);
        expect(inputs.idleContainers).toEqual([
            expect.objectContaining({ containerId: 'manual-c', peakRuPerBucket: 0 }),
            expect.objectContaining({ containerId: 'auto-c', peakRuPerBucket: 20 }),
        ]);
        expect(inputs.partitions.map((item) => item.containerId)).toEqual(['manual-c', 'auto-c']);
        expect(inputs.partitionMerges?.map((item) => item.containerId)).toEqual(['manual-c', 'auto-c']);
        expect(inputs.autoscaleUtilizations?.map((item) => item.containerId)).toEqual(['auto-c']);
        expect(inputs.serverlessThrottling?.map((item) => item.containerId)).toEqual(['serverless-c']);
        expect(inputs.scopeProvisionedRuTotal).toBe(10_000);
        expect(inputs.sharedThroughput).toEqual([expect.objectContaining({ databaseId: 'db-shared', sharedRu: 4000 })]);
        expect(vi.mocked(fetchCrossPartitionShapes).mock.calls.map((call) => call[3])).toEqual([
            'manual-c',
            'auto-c',
            'serverless-c',
        ]);
        expect(vi.mocked(fetchUncontrolledIngestion).mock.calls.map((call) => call[3])).toEqual(['manual-c', 'auto-c']);
        expect(result.metricSource).toEqual({ available: true, failures: [] });
    });

    it('records failures instead of downgrading missing metrics to zero', async () => {
        vi.mocked(getSqlInventoryDetails).mockResolvedValue({
            databases: ['db'],
            rows: [
                {
                    databaseId: 'db',
                    containerId: 'c',
                    throughputMode: 'dedicated',
                    throughputRU: 1000,
                    offerLevel: 'container',
                    offerThroughputMode: 'manual',
                    partitionKeyPaths: [],
                    indexingMode: 'consistent',
                    excludedPathCount: 0,
                    userExcludedPathCount: 0,
                    compositeIndexCount: 0,
                    health: 'Healthy',
                },
            ],
            offers: [
                {
                    databaseId: 'db',
                    containerId: 'c',
                    offerLevel: 'container',
                    throughputMode: 'dedicated',
                    offerThroughputMode: 'manual',
                    throughputRU: 1000,
                },
            ],
        });
        vi.mocked(getRuTrends).mockResolvedValue({
            available: true,
            points: [{ timestamp: 1, ruPercent: 20, throttled: false }],
            provisionedPercent: 100,
            timeRange: '7D',
            generatedAt: 1,
        });
        vi.mocked(getContainerIdlePeak).mockRejectedValue(new Error('idle failed'));
        vi.mocked(getInventoryMetrics).mockResolvedValue({
            available: true,
            metrics: {},
            generatedAt: 1,
        });
        vi.mocked(getPartitionHealth).mockResolvedValue({
            available: true,
            mode: 'ru',
            databaseId: 'db',
            containerId: 'c',
            tiles: [],
            skewScore: 0,
            topPartitionShare: 90,
            maxSaturationPercent: 90,
            minSaturationPercent: 20,
            partitionCount: 2,
            topN: 5,
            generatedAt: 1,
        });
        vi.mocked(getThrottleRate).mockRejectedValue(new Error('throttle failed'));
        vi.mocked(getPartitionStorageSeries).mockResolvedValue({
            available: true,
            databaseId: 'db',
            containerId: 'c',
            partitions: [{ partitionId: '0', samples: [{ timestamp: 1, bytes: 10 }] }],
            generatedAt: 1,
        });
        vi.mocked(getContainerPartitionCount).mockResolvedValue(2);
        vi.mocked(getAutoscaleUtilization).mockResolvedValue({
            peakPercent: 10,
            avgPercent: 5,
            sampleCount: 24,
        });
        vi.mocked(getAccountConsumedRuShape).mockResolvedValue({
            avgRuPerSec: 5,
            peakRuPerSec: 100,
            sampleCount: 50,
        });
        vi.mocked(probeCdbLogs).mockResolvedValue({ available: true });
        vi.mocked(fetchCrossPartitionShapes).mockResolvedValue({ databaseId: 'db', containerId: 'c', shapes: [] });
        vi.mocked(fetchUncontrolledIngestion).mockResolvedValue(undefined);
        vi.mocked(fetchSharedThroughputTraffic).mockResolvedValue({
            databaseId: 'db',
            sharedRu: 1000,
            collections: [],
        });
        vi.mocked(computeDerivedAdvisories).mockReturnValue([]);

        vi.mocked(getContainerMergeStoragePeak).mockRejectedValue(new Error('merge failed'));

        const result = await collectDerivedAdvisories(params());
        const inputs = vi.mocked(computeDerivedAdvisories).mock.calls[0][0];

        expect(inputs.idleContainers).toEqual([]);
        expect(inputs.partitions).toEqual([]);
        expect(inputs.partitionMerges).toEqual([]);
        expect(result.metricSource.available).toBe(false);
        expect(result.metricSource.failures).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'IdleContainer' }),
                expect.objectContaining({ rule: 'SustainedThrottlingInRegion', scope: 'db/c' }),
                expect.objectContaining({ rule: 'HotPartitionRisk', scope: 'db/c' }),
                expect.objectContaining({ rule: 'PartitionMergeCandidate' }),
            ]),
        );
    });

    it('returns config-backed advisories even when inventory collection fails', async () => {
        vi.mocked(getSqlInventoryDetails).mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 403 }));
        vi.mocked(getAccountConsumedRuShape).mockResolvedValue({
            avgRuPerSec: 1,
            peakRuPerSec: 20,
            sampleCount: 30,
        });
        vi.mocked(probeCdbLogs).mockResolvedValue({ available: true });
        vi.mocked(fetchCrossPartitionShapes).mockResolvedValue({ databaseId: 'db', containerId: 'c', shapes: [] });
        vi.mocked(fetchUncontrolledIngestion).mockResolvedValue(undefined);
        vi.mocked(fetchSharedThroughputTraffic).mockResolvedValue({
            databaseId: 'db',
            sharedRu: 1000,
            collections: [],
        });
        vi.mocked(computeDerivedAdvisories).mockReturnValue([advisory('ExpensiveConsistency')]);

        const result = await collectDerivedAdvisories(params({ logsClient: undefined }));

        expect(result.advisories).toEqual([expect.objectContaining({ rule: 'ExpensiveConsistency' })]);
        expect(result.metricSource.available).toBe(false);
        expect(result.metricSource.failures).toEqual(
            expect.arrayContaining([expect.objectContaining({ rule: 'OverProvisioning', reason: 'rbac' })]),
        );
    });
});
