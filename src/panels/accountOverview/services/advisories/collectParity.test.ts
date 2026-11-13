/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import type * as InventoryModule from '../inventory';
import type * as RuTrendsModule from '../ruTrends';
import type * as EngineModule from './engine';
import type * as MetricsModule from './fetchers/metrics';

vi.mock('../inventory', () => ({
    getSqlInventoryDetails: vi.fn(),
}));

vi.mock('../partitionHealth', async () => {
    const { OVERVIEW_DEFAULTS } = await import('../healthPolicy');
    return {
        DEFAULT_PARTITION_THRESHOLDS: OVERVIEW_DEFAULTS.partition,
        getPartitionHealth: vi.fn(),
        getPartitionStorageSeries: vi.fn(),
    };
});

vi.mock('../ruTrends', async (importOriginal) => ({
    ...(await importOriginal<typeof RuTrendsModule>()),
    getRuTrends: vi.fn(),
    getThrottleRate: vi.fn(),
}));

vi.mock('./engine', () => ({
    computeDerivedAdvisories: vi.fn(),
}));

vi.mock('./fetchers/logs', () => ({
    fetchConsistencyReadRu: vi.fn(),
    fetchCrossPartitionShapes: vi.fn(),
    fetchSharedThroughputTraffic: vi.fn(),
    fetchUncontrolledIngestion: vi.fn(),
    logWindow: vi.fn(() => ({ startTime: new Date(0), endTime: new Date(1) })),
    probeCdbLogs: vi.fn(),
    selectDataPlaneSource: vi.fn(),
    requestLogWindow: vi.fn(() => ({ startTime: new Date(0), endTime: new Date(1) })),
}));

vi.mock('./fetchers/metrics', () => ({
    getAccountConsumedRuShape: vi.fn(),
    getAccountRequestStatusCounts: vi.fn(),
    getThrottledOperationCounts: vi.fn(),
    getAutoscaleUtilization: vi.fn(),
    getContainerIdlePeak: vi.fn(),
    getContainerIndexingUsage: vi.fn(),
    getContainerMergeStoragePeak: vi.fn(),
    getContainerPartitionCount: vi.fn(),
}));

import { CosmosDBManagementClient, type ThroughputSettingsGetResults } from '@azure/arm-cosmosdb';
import { MonitorClient, type Response as MetricsResponse } from '@azure/arm-monitor';
import { getSqlInventoryDetails } from '../inventory';
import { getPartitionHealth, getPartitionStorageSeries } from '../partitionHealth';
import { getRuTrends, getThrottleRate } from '../ruTrends';
import { GB, pagedItems } from '../testFixtures';
import { collectDerivedAdvisories } from './collect';
import { DEFAULT_ADVISORY_THRESHOLDS, DIAGNOSTIC_POLICY } from './core/thresholds';
import { type DerivedAdvisory, type DerivedAdvisoryRule } from './core/types';
import { computeDerivedAdvisories } from './engine';
import {
    fetchConsistencyReadRu,
    fetchCrossPartitionShapes,
    fetchSharedThroughputTraffic,
    fetchUncontrolledIngestion,
    probeCdbLogs,
    selectDataPlaneSource,
} from './fetchers/logs';
import {
    getAccountConsumedRuShape,
    getAccountRequestStatusCounts,
    getAutoscaleUtilization,
    getContainerIdlePeak,
    getContainerIndexingUsage,
    getContainerMergeStoragePeak,
    getContainerPartitionCount,
    getThrottledOperationCounts,
} from './fetchers/metrics';

beforeEach(() => {
    vi.mocked(getAccountRequestStatusCounts).mockResolvedValue({ 200: 1000 });
    vi.mocked(selectDataPlaneSource).mockResolvedValue('CDBDataPlaneRequests');
    vi.mocked(probeCdbLogs).mockResolvedValue({ available: false, reason: 'noData' });
});

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
        advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
        accountConfig: {
            accountName: 'acct-prod',
            regionCount: 2,
            multiRegionWritesEnabled: false,
            writeRegionCount: 1,
            api: API.Core,
            backupPolicy: { type: 'Periodic' },
            perRegionPerPartitionAutoscaleEnabled: true,
        },
        logsClient: { queryResource: vi.fn() },
        ...overrides,
    };
}

describe('collectDerivedAdvisories parity wiring', () => {
    it.each([true, false])(
        'reports reservation inventory failure only for provisioned accounts (serverless=%s)',
        async (isServerless) => {
            vi.mocked(getSqlInventoryDetails).mockRejectedValue({ statusCode: 403 });
            vi.mocked(computeDerivedAdvisories).mockReturnValue([]);
            const result = await collectDerivedAdvisories(params({ isServerless, logsClient: undefined }));
            const failures = result.metricSource.failures.filter(
                (failure) => failure.rule === 'ReservedCapacityCandidate',
            );
            expect(failures).toEqual(isServerless ? [] : [{ rule: 'ReservedCapacityCandidate', reason: 'rbac' }]);
            expect(vi.mocked(computeDerivedAdvisories).mock.calls[0][0].scopeProvisionedRuTotal).toBeUndefined();
        },
    );

    it.each([true, false])(
        'uses the account capacity baseline only for complete throughput inventory (complete=%s)',
        async (throughputInventoryComplete) => {
            vi.mocked(getSqlInventoryDetails).mockResolvedValue({
                databases: ['db'],
                rows: [],
                offers: [
                    {
                        databaseId: 'db',
                        offerLevel: 'database',
                        throughputMode: 'shared',
                        offerThroughputMode: 'manual',
                        throughputRU: 6000,
                        resourceCreatedAt: '2020-01-01T00:00:00Z',
                    },
                ],
                throughputInventoryComplete,
            });
            vi.mocked(computeDerivedAdvisories).mockReturnValue([]);
            vi.mocked(getRuTrends).mockResolvedValue({
                available: false,
                reason: 'noData',
                points: [],
                provisionedPercent: 100,
                timeRange: '7D',
                generatedAt: 0,
            });
            await collectDerivedAdvisories(params({ logsClient: undefined }));
            const inputs = vi.mocked(computeDerivedAdvisories).mock.calls[0][0];
            expect(inputs.scopeProvisionedRuTotal).toBe(throughputInventoryComplete ? 6000 : undefined);
            expect(inputs.manualProvisionedRuTotal === undefined || throughputInventoryComplete).toBe(true);
        },
    );

    it.each([
        { name: 'all manual', complete: true, sharedAutoscale: false, dedicatedAutoscale: false, capacity: 7000 },
        {
            name: 'shared autoscale',
            complete: true,
            sharedAutoscale: true,
            dedicatedAutoscale: false,
            capacity: undefined,
        },
        {
            name: 'dedicated autoscale',
            complete: true,
            sharedAutoscale: false,
            dedicatedAutoscale: true,
            capacity: undefined,
        },
        { name: 'incomplete', complete: false, sharedAutoscale: false, dedicatedAutoscale: false, capacity: undefined },
    ])(
        'quantifies regional capacity only for complete all-manual offers ($name)',
        async ({ complete, sharedAutoscale, dedicatedAutoscale, capacity }) => {
            const engine = await vi.importActual<typeof EngineModule>('./engine');
            vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
            const offers: InventoryModule.InventoryThroughputOffer[] = [
                {
                    databaseId: 'db',
                    offerLevel: 'database',
                    throughputMode: sharedAutoscale ? 'autoscale' : 'shared',
                    offerThroughputMode: sharedAutoscale ? 'autoscale' : 'manual',
                    throughputRU: 6000,
                },
                {
                    databaseId: 'db',
                    containerId: 'dedicated',
                    offerLevel: 'container',
                    throughputMode: dedicatedAutoscale ? 'autoscale' : 'dedicated',
                    offerThroughputMode: dedicatedAutoscale ? 'autoscale' : 'manual',
                    throughputRU: 1000,
                },
            ];
            const rows = offers.flatMap((offer) =>
                (offer.containerId === undefined
                    ? ['shared-a', 'shared-b']
                    : [offer.containerId]
                ).map<InventoryModule.InventoryContainerRow>((containerId) => ({
                    ...offer,
                    containerId,
                    resourceCreatedAt: '2020-01-01T00:00:00Z',
                    partitionKeyPaths: [],
                    indexingMode: 'none',
                    excludedPathCount: 0,
                    userExcludedPathCount: 0,
                    compositeIndexCount: 0,
                    health: 'Healthy',
                })),
            );
            vi.mocked(getSqlInventoryDetails).mockResolvedValue({
                databases: ['db'],
                rows,
                offers,
                throughputInventoryComplete: complete,
            });
            vi.mocked(getRuTrends).mockResolvedValue({
                available: false,
                reason: 'noData',
                points: [],
                provisionedPercent: 100,
                timeRange: '7D',
                generatedAt: 0,
            });

            const result = await collectDerivedAdvisories(
                params({
                    logsClient: undefined,
                    accountConfig: {
                        accountName: 'orders-dev',
                        regionCount: 3,
                        multiRegionWritesEnabled: true,
                        writeRegionCount: 3,
                        api: API.Core,
                    },
                }),
            );

            const inputs = vi.mocked(computeDerivedAdvisories).mock.calls[0][0];
            expect(inputs.scopeProvisionedRuTotal).toBe(complete ? 7000 : undefined);
            expect(inputs.manualRegionalCapacityRu).toBe(capacity);
            const finding = result.advisories.find((item) => item.rule === 'MultiRegionWriteAntipattern');
            expect(finding).toMatchObject({ severity: 'Medium' });
            expect(finding?.evidence).toEqual(
                capacity === undefined
                    ? undefined
                    : {
                          regionalCapacityQuantified: true,
                          configuredPerRegionRu: 7000,
                          globalRegionalFootprintRu: 21000,
                          removableExtraRegionRu: 14000,
                      },
            );
        },
    );

    it('passes optional read-charge evidence through the production collector to the configuration finding', async () => {
        const engine = await vi.importActual<typeof EngineModule>('./engine');
        vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
        vi.mocked(getSqlInventoryDetails).mockResolvedValue({
            rows: [],
            offers: [],
            databases: [],
            throughputInventoryComplete: true,
        });
        const readCharge = {
            sourceTable: 'CDBDataPlaneRequests' as const,
            sourceResolution: 'perRequest' as const,
            observationStart: '2026-11-10T00:00:00Z',
            observationEnd: '2026-11-11T00:00:00Z',
            status: 'observed' as const,
            readRequests: 50,
            readRu: 400,
        };
        vi.mocked(fetchConsistencyReadRu).mockResolvedValue(readCharge);
        const base = params();
        const result = await collectDerivedAdvisories({
            ...base,
            accountConfig: { ...base.accountConfig, consistencyLevel: 'Strong' },
        });
        expect(fetchConsistencyReadRu).toHaveBeenCalledOnce();
        expect(result.advisories.find((item) => item.rule === 'ExpensiveConsistency')?.evidence).toMatchObject({
            readRuStatus: 'observed',
            observedReadRequests: 50,
            observedReadRu: 400,
            upperBoundAvoidableReadRu: 200,
        });
    });

    it.each([
        ['Session', 2],
        ['BoundedStaleness', 1],
        [undefined, 2],
    ] as const)(
        'does not request optional read RU without a positive consistency finding: %s/%s',
        async (consistencyLevel, regionCount) => {
            vi.mocked(getSqlInventoryDetails).mockResolvedValue({
                rows: [],
                offers: [],
                databases: [],
                throughputInventoryComplete: true,
            });
            vi.mocked(computeDerivedAdvisories).mockReturnValue([]);
            const base = params();
            await collectDerivedAdvisories({
                ...base,
                accountConfig: { ...base.accountConfig, consistencyLevel, regionCount },
            });
            expect(fetchConsistencyReadRu).not.toHaveBeenCalled();
        },
    );

    it('shares one account status read between DX-020/021 even when inventory is denied', async () => {
        const engine = await vi.importActual<typeof EngineModule>('./engine');
        vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
        vi.mocked(getSqlInventoryDetails).mockRejectedValue({ statusCode: 403 });
        vi.mocked(getAccountRequestStatusCounts).mockResolvedValue({ 200: 800, 404: 100, 429: 100 });
        vi.mocked(getThrottledOperationCounts).mockResolvedValue({ Create: 100 });

        const result = await collectDerivedAdvisories(params({ logsClient: undefined }));
        expect(result.advisories.map((item) => item.rule)).toEqual(['NonThrottlingErrors', 'ThrottlingByOperation']);
        expect(getAccountRequestStatusCounts).toHaveBeenCalledOnce();
        expect(getThrottledOperationCounts).toHaveBeenCalledOnce();
        expect(vi.mocked(getAccountRequestStatusCounts).mock.calls[0][2]).toBe(
            vi.mocked(getThrottledOperationCounts).mock.calls[0][2],
        );
        expect(result.metricSource.failures).toContainEqual({ rule: 'ReservedCapacityCandidate', reason: 'rbac' });
        expect(result.logSource.available).toBe(false);
    });

    it.each<{ statusCounts: Record<string, number> }>([
        { statusCounts: { 200: 899, 429: 100 } },
        { statusCounts: { 200: 9991, 429: 9 } },
        { statusCounts: { 200: 1000 } },
    ])('does not request an operation split below the DX-021 gates: %j', async ({ statusCounts }) => {
        vi.mocked(getSqlInventoryDetails).mockResolvedValue({
            rows: [],
            offers: [],
            databases: [],
            throughputInventoryComplete: true,
        });
        vi.mocked(getAccountRequestStatusCounts).mockResolvedValue(statusCounts);
        vi.mocked(computeDerivedAdvisories).mockReturnValue([]);
        await collectDerivedAdvisories(params({ logsClient: undefined }));
        expect(getThrottledOperationCounts).not.toHaveBeenCalled();
    });

    it.each(['denied', 'empty'] as const)(
        'preserves errors while reporting %s throttled-operation evidence as incomplete',
        async (scenario) => {
            const engine = await vi.importActual<typeof EngineModule>('./engine');
            vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
            vi.mocked(getSqlInventoryDetails).mockResolvedValue({
                rows: [],
                offers: [],
                databases: [],
                throughputInventoryComplete: true,
            });
            vi.mocked(getAccountRequestStatusCounts).mockResolvedValue({ 200: 800, 500: 100, 429: 100 });
            if (scenario === 'denied') {
                vi.mocked(getThrottledOperationCounts).mockRejectedValue({ statusCode: 403 });
            } else {
                vi.mocked(getThrottledOperationCounts).mockResolvedValue({});
            }
            const result = await collectDerivedAdvisories(params({ logsClient: undefined }));
            expect(result.advisories.map((item) => item.rule)).toEqual(['NonThrottlingErrors']);
            expect(result.metricSource.failures).toContainEqual({
                rule: 'ThrottlingByOperation',
                reason: scenario === 'denied' ? 'rbac' : 'noData',
                scope: undefined,
            });
        },
    );

    it('reports both account rules when status collection fails, without attempting operations', async () => {
        vi.mocked(getSqlInventoryDetails).mockResolvedValue({
            rows: [],
            offers: [],
            databases: [],
            throughputInventoryComplete: true,
        });
        vi.mocked(getAccountRequestStatusCounts).mockRejectedValue({ statusCode: 403 });
        vi.mocked(computeDerivedAdvisories).mockReturnValue([]);
        const result = await collectDerivedAdvisories(params({ logsClient: undefined }));
        expect(result.metricSource.failures).toEqual([
            { rule: 'NonThrottlingErrors', reason: 'rbac', scope: undefined },
            { rule: 'ThrottlingByOperation', reason: 'rbac', scope: undefined },
        ]);
        expect(getThrottledOperationCounts).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'uses one authoritative shared offer for reservation review; duplicate=%s',
        async (duplicate) => {
            const engine = await vi.importActual<typeof EngineModule>('./engine');
            vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
            const offer = {
                databaseId: 'db',
                throughputRU: 3000,
                offerLevel: 'database',
                throughputMode: 'shared',
                offerThroughputMode: 'manual',
                resourceCreatedAt: '2020-01-01T00:00:00.000Z',
            } as const;
            vi.mocked(getSqlInventoryDetails).mockResolvedValue({
                rows: [],
                offers: duplicate ? [offer, offer] : [offer],
                databases: ['db'],
                throughputInventoryComplete: true,
            });
            vi.mocked(getRuTrends).mockResolvedValue({
                available: false,
                points: [],
                provisionedPercent: 100,
                timeRange: '7D',
                generatedAt: 0,
            });
            const result = await collectDerivedAdvisories(params({ logsClient: undefined }));
            const reservations = result.advisories.filter((item) => item.rule === 'ReservedCapacityCandidate');
            expect(reservations).toHaveLength(duplicate ? 0 : 1);
            const inputs = vi.mocked(computeDerivedAdvisories).mock.calls[0][0];
            expect(inputs.scopeProvisionedRuTotal).toBe(duplicate ? undefined : 3000);
            expect(inputs.manualRegionalCapacityRu).toBe(duplicate ? undefined : 3000);
            expect(result.metricSource.failures.some((failure) => failure.rule === 'ReservedCapacityCandidate')).toBe(
                duplicate,
            );
        },
    );

    it.each<{
        scope:
            | 'container'
            | 'shared database'
            | 'empty database'
            | 'unresolved container'
            | 'container on shared database';
        response?: ThroughputSettingsGetResults;
        total?: number;
    }>([
        { scope: 'container', response: { resource: {} } },
        { scope: 'container', response: {} },
        { scope: 'shared database', response: { resource: {} } },
        { scope: 'shared database', response: {} },
        { scope: 'empty database', response: { resource: {} } },
        { scope: 'empty database', response: {} },
        { scope: 'unresolved container' },
        { scope: 'container on shared database', response: {} },
        { scope: 'container on shared database', response: { resource: {} } },
        { scope: 'container', response: { resource: { throughput: 1000 } }, total: 4000 },
        { scope: 'shared database', response: { resource: { throughput: 1000 } }, total: 4000 },
        { scope: 'empty database', response: { resource: { throughput: 1000 } }, total: 4000 },
        { scope: 'empty database', total: 3000 },
    ])('requires complete ARM inventory for DX-023 and DX-008: %j', async ({ scope, response, total }) => {
        const inventory = await vi.importActual<typeof InventoryModule>('../inventory');
        const engine = await vi.importActual<typeof EngineModule>('./engine');
        vi.mocked(getSqlInventoryDetails).mockImplementation(inventory.getSqlInventoryDetails);
        vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
        const missingOffer = Object.assign(new Error('Not found'), { statusCode: 404 });
        const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
        vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({
            systemData: { createdAt: new Date('2020-01-01T00:00:00.000Z') },
        });
        vi.spyOn(cosmosClient.sqlResources, 'listSqlDatabases').mockImplementation(() =>
            pagedItems([{ resource: { id: 'known-db' } }, { resource: { id: 'target-db' } }]),
        );
        vi.spyOn(cosmosClient.sqlResources, 'getSqlDatabaseThroughput').mockImplementation(
            async (_rg, _account, database) => {
                if (database !== 'target-db' || scope === 'container' || scope === 'unresolved container') {
                    throw missingOffer;
                }
                if (scope === 'container on shared database') {
                    return { resource: { throughput: 1000 } };
                }
                if (response === undefined) {
                    throw missingOffer;
                }
                return response;
            },
        );
        vi.spyOn(cosmosClient.sqlResources, 'listSqlContainers').mockImplementation((_rg, _account, database) =>
            pagedItems(
                database === 'known-db' || scope !== 'empty database'
                    ? [
                          {
                              resource: { id: database === 'known-db' ? 'known' : 'target' },
                              systemData: { createdAt: new Date('2020-01-01T00:00:00.000Z') },
                          },
                      ]
                    : [],
            ),
        );
        vi.spyOn(cosmosClient.sqlResources, 'getSqlContainerThroughput').mockImplementation(
            async (_rg, _account, database) => {
                if (database === 'known-db') {
                    return { resource: { throughput: 3000 } };
                }
                if ((scope === 'container' || scope === 'container on shared database') && response !== undefined) {
                    return response;
                }
                throw missingOffer;
            },
        );
        vi.mocked(getRuTrends).mockResolvedValue({
            available: true,
            points: Array.from({ length: 24 }, (_, timestamp) => ({ timestamp, ruPercent: 10, throttled: false })),
            peakPercent: 10,
            provisionedPercent: 100,
            timeRange: '7D',
            generatedAt: 0,
        });
        vi.mocked(getContainerIdlePeak).mockResolvedValue(1000);
        const result = await collectDerivedAdvisories(
            params({
                cosmosClient,
                logsClient: undefined,
                accountConfig: {
                    accountName: 'acct-dev',
                    regionCount: 2,
                    writeRegionCount: 2,
                    multiRegionWritesEnabled: true,
                    api: API.Core,
                    backupPolicy: { type: 'Periodic' },
                    perRegionPerPartitionAutoscaleEnabled: true,
                },
            }),
        );
        const collectedInventory = await vi.mocked(getSqlInventoryDetails).mock.results[0].value;
        expect(collectedInventory.throughputInventoryComplete).toBe(total !== undefined);
        const inputs = vi.mocked(computeDerivedAdvisories).mock.calls[0][0];
        expect(inputs.scopeProvisionedRuTotal).toBe(total);
        expect(inputs.manualProvisionedRuTotal).toBe(total);
        expect(inputs.manualRegionalCapacityRu).toBe(total);
        expect(result.advisories.some((item) => item.rule === 'ReservedCapacityCandidate')).toBe(total !== undefined);
        expect(
            result.advisories.filter((item) => item.rule === 'OverProvisioning').map((item) => item.scope),
        ).toContain('known-db/known');
        const regional = result.advisories.find((item) => item.rule === 'MultiRegionWriteAntipattern');
        expect(regional?.severity).toBe('Medium');
        expect(regional?.evidence).toEqual(
            total === undefined
                ? undefined
                : {
                      regionalCapacityQuantified: true,
                      configuredPerRegionRu: total,
                      globalRegionalFootprintRu: total * 2,
                      removableExtraRegionRu: total,
                  },
        );
        expect(result.metricSource.failures.filter((failure) => failure.rule === 'ReservedCapacityCandidate')).toEqual(
            total === undefined ? [{ rule: 'ReservedCapacityCandidate', reason: 'noData', scope: undefined }] : [],
        );
    });

    it.each(['none', 'NoNe', 'NONE'])(
        'skips DX-024 metric acquisition and coverage failures for %s indexing',
        async (indexingMode) => {
            const inventory = await vi.importActual<typeof InventoryModule>('../inventory');
            const engine = await vi.importActual<typeof EngineModule>('./engine');
            vi.mocked(getSqlInventoryDetails).mockImplementation(inventory.getSqlInventoryDetails);
            vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
            const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
            vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({});
            vi.spyOn(cosmosClient.sqlResources, 'listSqlDatabases').mockImplementation(() =>
                pagedItems([{ resource: { id: 'db' } }]),
            );
            vi.spyOn(cosmosClient.sqlResources, 'listSqlContainers').mockImplementation(() =>
                pagedItems([{ resource: { id: 'disabled', indexingPolicy: { indexingMode } } }]),
            );
            vi.mocked(getThrottleRate).mockResolvedValue({ ratePercent: 0, totalRequests: 0 });
            vi.mocked(getContainerIndexingUsage).mockRejectedValue({ statusCode: 403 });

            const result = await collectDerivedAdvisories(
                params({ cosmosClient, isServerless: true, logsClient: undefined }),
            );

            expect(result.metricSource.failures.filter((failure) => failure.rule === 'IndexingCostRisk')).toEqual([]);
            expect(getContainerIndexingUsage).not.toHaveBeenCalled();
            expect(result.advisories.filter((item) => item.rule === 'IndexingCostRisk')).toEqual([]);
            expect(vi.mocked(computeDerivedAdvisories).mock.calls[0][0].indexing).toEqual([]);
        },
    );

    it.each<{ indexingMode: string | undefined; outcome: 'positive' | 'empty' | 'denied' }>([
        { indexingMode: 'consistent', outcome: 'positive' },
        { indexingMode: 'lazy', outcome: 'positive' },
        { indexingMode: undefined, outcome: 'positive' },
        { indexingMode: 'unknown', outcome: 'positive' },
        { indexingMode: 'consistent', outcome: 'empty' },
        { indexingMode: 'consistent', outcome: 'denied' },
    ])(
        'preserves DX-024 $outcome results for $indexingMode indexing beside a disabled container',
        async ({ indexingMode, outcome }) => {
            const inventory = await vi.importActual<typeof InventoryModule>('../inventory');
            const engine = await vi.importActual<typeof EngineModule>('./engine');
            vi.mocked(getSqlInventoryDetails).mockImplementation(inventory.getSqlInventoryDetails);
            vi.mocked(computeDerivedAdvisories).mockImplementation(engine.computeDerivedAdvisories);
            const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
            vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({});
            vi.spyOn(cosmosClient.sqlResources, 'listSqlDatabases').mockImplementation(() =>
                pagedItems([{ resource: { id: 'db' } }]),
            );
            vi.spyOn(cosmosClient.sqlResources, 'listSqlContainers').mockImplementation(() =>
                pagedItems([
                    { resource: { id: 'disabled', indexingPolicy: { indexingMode: 'none' } } },
                    { resource: { id: 'eligible', indexingPolicy: { indexingMode } } },
                ]),
            );
            vi.mocked(getThrottleRate).mockResolvedValue({ ratePercent: 0, totalRequests: 0 });
            if (outcome === 'denied') {
                vi.mocked(getContainerIndexingUsage).mockRejectedValue({ statusCode: 403 });
            } else {
                vi.mocked(getContainerIndexingUsage).mockResolvedValue(
                    outcome === 'positive' ? { indexUsageBytes: 60, dataUsageBytes: 100 } : {},
                );
            }

            const collectionParams = params({ cosmosClient, isServerless: true, logsClient: undefined });
            const result = await collectDerivedAdvisories(collectionParams);

            expect(getContainerIndexingUsage).toHaveBeenCalledExactlyOnceWith(
                collectionParams.monitorClient,
                collectionParams.accountId,
                'db',
                'eligible',
                expect.any(Number),
            );
            expect(
                result.advisories.filter((item) => item.rule === 'IndexingCostRisk').map((item) => item.scope),
            ).toEqual(outcome === 'positive' ? ['db/eligible'] : []);
            expect(result.metricSource.failures.filter((failure) => failure.rule === 'IndexingCostRisk')).toEqual(
                outcome === 'positive'
                    ? []
                    : [
                          {
                              rule: 'IndexingCostRisk',
                              scope: 'db/eligible',
                              reason: outcome === 'denied' ? 'rbac' : 'noData',
                          },
                      ],
            );
        },
    );

    it.each([
        { paths: [], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/_etag/?'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/"_etag"/?'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/_etag/?', '/payload/*'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/"_etag"/?', '/payload/*'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/payload/_etag/?'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/payload/"_etag"/?'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
        { paths: ['/_etag/*'], indexUsageBytes: 50, dataUsageBytes: 100, fires: true },
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
            vi.mocked(getContainerIndexingUsage).mockResolvedValue({ indexUsageBytes, dataUsageBytes });

            const result = await collectDerivedAdvisories(
                params({ cosmosClient, isServerless: true, logsClient: undefined }),
            );

            expect(result.advisories.filter((item) => item.rule === 'IndexingCostRisk')).toHaveLength(fires ? 1 : 0);
            expect(getContainerIndexingUsage).toHaveBeenCalledWith(
                expect.anything(),
                expect.any(String),
                'db',
                'events',
                expect.any(Number),
            );
            expect(getRuTrends).not.toHaveBeenCalled();
            expect(getPartitionHealth).not.toHaveBeenCalled();
            const collectedInventory = await vi.mocked(getSqlInventoryDetails).mock.results[0].value;
            expect(collectedInventory.rows[0].excludedPathCount).toBe(paths.length);
            expect(indexingPolicy).toEqual(originalPolicy);

            vi.mocked(getContainerIndexingUsage).mockResolvedValue({});
            const unavailable = await collectDerivedAdvisories(
                params({ cosmosClient, isServerless: true, logsClient: undefined }),
            );
            expect(unavailable.advisories.some((item) => item.rule === 'IndexingCostRisk')).toBe(false);
            expect(unavailable.metricSource.failures).toContainEqual({
                rule: 'IndexingCostRisk',
                reason: 'noData',
                scope: 'db/events',
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
        'full fidelity',
        'full fidelity without backup policy',
        'disabled full fidelity',
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
                throughputInventoryComplete: true,
            });
            vi.mocked(getRuTrends).mockResolvedValue({
                available: false,
                points: [],
                provisionedPercent: 100,
                timeRange: '7D',
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

            const fullFidelityChangeFeedEnabled =
                scenario === 'full fidelity' || scenario === 'full fidelity without backup policy'
                    ? true
                    : scenario === 'disabled full fidelity'
                      ? false
                      : undefined;
            const backupPolicy = {
                type: scenario === 'full fidelity without backup policy' ? undefined : 'Periodic',
                fullFidelityChangeFeedEnabled,
            };
            const options = params({ monitorClient, logsClient: undefined });
            options.accountConfig = { ...options.accountConfig, backupPolicy };
            const result = await collectDerivedAdvisories(options);
            const inputs = vi.mocked(computeDerivedAdvisories).mock.calls[0][0];
            const missingIdle = scenario === 'access denied';
            const missingMerge =
                scenario === 'missing partition count' ||
                scenario === 'missing storage' ||
                scenario === 'access denied';
            const idleRows = missingIdle ? rows.slice(1) : rows;
            const mergeRows = missingMerge ? rows.slice(1) : rows;
            const metricFailures = result.metricSource.failures.filter(
                (failure) => failure.rule === 'IdleContainer' || failure.rule === 'PartitionMergeCandidate',
            );

            const idleAdvisories = result.advisories.filter((item) => item.rule === 'IdleContainer');
            const idleFinding = expect.objectContaining({
                scope: 'db0/c0',
                evidence: { peakRuPerBucket: 0, provisionedRu: 1000, recoverableRu: 1000 },
            });
            expect.soft(idleAdvisories).toEqual(scenario === 'missing idle' ? [idleFinding] : []);
            expect.soft(inputs.idleContainers).toHaveLength(idleRows.length);
            for (const row of idleRows) {
                expect.soft(inputs.idleContainers).toContainEqual(
                    expect.objectContaining({
                        databaseId: row.databaseId,
                        containerId: row.containerId,
                        peakRuPerBucket: scenario === 'missing idle' && row === rows[0] ? 0 : 1000,
                    }),
                );
            }
            expect.soft(inputs.partitionMerges).toHaveLength(mergeRows.length);
            const mergeAdvisories = result.advisories.filter((item) => item.rule === 'PartitionMergeCandidate');
            expect.soft(mergeAdvisories).toHaveLength(mergeRows.length);
            for (const row of mergeRows) {
                expect.soft(inputs.partitionMerges).toContainEqual({
                    databaseId: row.databaseId,
                    containerId: row.containerId,
                    actualPartitions: 4,
                    provisionedRu: 1000,
                    dataUsageBytes: scenario === 'zero storage' && row === rows[0] ? 0 : GB,
                    backupPolicy,
                });
                expect
                    .soft(
                        mergeAdvisories.find((advisory) => advisory.scope === `${row.databaseId}/${row.containerId}`)
                            ?.actionEligibility,
                    )
                    .toBe(fullFidelityChangeFeedEnabled === true ? 'blocked' : 'requiresValidation');
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
            throughputInventoryComplete: true,
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

    it('evaluates dedicated and shared database offers, with capacity counted once per offer', async () => {
        vi.mocked(getSqlInventoryDetails).mockResolvedValue({
            databases: ['db-shared', 'db-manual', 'db-auto', 'db-sls'],
            throughputInventoryComplete: true,
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
        vi.mocked(getContainerIndexingUsage).mockResolvedValue({ indexUsageBytes: 20, dataUsageBytes: 100 });
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
            evaluationWindowSeconds: 86400,
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
        expect(getPartitionHealth).toHaveBeenCalledWith(
            expect.anything(),
            expect.any(String),
            'ru',
            DIAGNOSTIC_POLICY.partitionSaturation.observation.timeRange,
            expect.any(String),
            expect.any(String),
            {
                saturationPercent: DEFAULT_ADVISORY_THRESHOLDS.partitionSaturationPercent,
                headroomPercent: DEFAULT_ADVISORY_THRESHOLDS.partitionHeadroomPercent,
                skewBalanceRatio: DEFAULT_ADVISORY_THRESHOLDS.storageSkewBalanceRatio,
                topN: 5,
            },
            DIAGNOSTIC_POLICY.partitionSaturation.observation,
            DIAGNOSTIC_POLICY.partitionSaturation.percentile,
        );

        expect(inputs.manualThroughput).toEqual([
            expect.objectContaining({ databaseId: 'db-manual', containerId: 'manual-c', provisionedRu: 1000 }),
        ]);
        expect(inputs.idleContainers).toEqual([
            expect.objectContaining({ databaseId: 'db-shared', containerId: undefined, peakRuPerBucket: 20 }),
            expect.objectContaining({ containerId: 'manual-c', peakRuPerBucket: 0 }),
            expect.objectContaining({ containerId: 'auto-c', peakRuPerBucket: 20 }),
        ]);
        expect(inputs.partitions.map((item) => item.containerId)).toEqual([undefined, 'manual-c', 'auto-c']);
        expect(inputs.partitionMerges?.map((item) => item.containerId)).toEqual(['manual-c', 'auto-c']);
        expect(inputs.autoscaleUtilizations?.map((item) => item.containerId)).toEqual([undefined, 'auto-c']);
        expect(inputs.serverlessThrottling?.map((item) => item.containerId)).toEqual(['serverless-c']);
        expect(inputs.scopeProvisionedRuTotal).toBe(10_000);
        expect(inputs.manualRegionalCapacityRu).toBeUndefined();
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
            throughputInventoryComplete: true,
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
        vi.mocked(fetchCrossPartitionShapes).mockResolvedValue({
            databaseId: 'db',
            containerId: 'c',
            shapes: [],
            evaluationWindowSeconds: 86400,
        });
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
        vi.mocked(fetchCrossPartitionShapes).mockResolvedValue({
            databaseId: 'db',
            containerId: 'c',
            shapes: [],
            evaluationWindowSeconds: 86400,
        });
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
