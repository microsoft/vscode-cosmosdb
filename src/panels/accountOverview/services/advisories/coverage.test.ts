/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import * as inventory from '../inventory';
import { withReadDiagnostics } from '../readDiagnostics';
import * as resourceAge from '../resourceAge';
import { dims, GB, iso, mockClient } from '../testFixtures';
import { DAY } from '../units';
import { collectDerivedAdvisories } from './collect';
import { DEFAULT_ADVISORY_THRESHOLDS } from './core/thresholds';
import {
    DERIVED_ADVISORY_RULES,
    type DerivedAdvisoryInputs,
    type DerivedAdvisoryRule,
    type DetectorCoverage,
    type PartitionSaturationInput,
} from './core/types';
import { completeDetectorCoverage } from './coverage';
import { analyzeDerivedAdvisories, computeDerivedAdvisories } from './engine';
import { type LogsOperation } from './fetchers/logsDiagnostics';
import * as metrics from './fetchers/metrics';
import { DETECTORS } from './registry';

const emptyInputs: DerivedAdvisoryInputs = {
    weeklyRuPercents: [],
    hasManualThroughput: false,
    manualThroughput: [],
    partitions: [],
    storage: [],
    indexing: [],
};

function entry(rule: DerivedAdvisoryRule, overrides: Partial<DetectorCoverage> = {}): DetectorCoverage {
    return {
        rule,
        status: 'insufficientData',
        evaluatedCount: 0,
        matchedCount: 0,
        notApplicableCount: 0,
        insufficientDataCount: 0,
        unavailableReasons: [],
        ...overrides,
    };
}

function partition(overrides: Partial<PartitionSaturationInput> = {}): PartitionSaturationInput {
    return {
        databaseId: 'private-database',
        containerId: 'private-container',
        resourceAgeDays: 30,
        partitionCount: 4,
        maxP99: 95,
        minP99: 30,
        totalRequests: 5000,
        throttleRatePercent: 5,
        throughputMode: 'dedicated',
        provisionedRu: 1000,
        ...overrides,
    };
}

function inventoryRow(overrides: Partial<inventory.InventoryContainerRow> = {}): inventory.InventoryContainerRow {
    return {
        databaseId: 'private-db',
        containerId: 'private-container',
        throughputMode: 'dedicated',
        throughputRU: 1000,
        offerLevel: 'container',
        offerThroughputMode: 'manual',
        resourceCreatedAt: '2020-01-01T00:00:00.000Z',
        partitionKeyPaths: [],
        indexingMode: 'consistent',
        excludedPathCount: 0,
        userExcludedPathCount: 0,
        compositeIndexCount: 0,
        health: 'Healthy',
        ...overrides,
    };
}

describe('pure detector coverage', () => {
    it('covers exactly the registered rule catalog, including rules with no inputs', () => {
        const result = analyzeDerivedAdvisories(emptyInputs, DEFAULT_ADVISORY_THRESHOLDS);

        expect(result.detectorCoverage.map(({ rule }) => rule).sort()).toEqual([...DERIVED_ADVISORY_RULES].sort());
        expect(new Set(DETECTORS.map(({ rule }) => rule)).size).toBe(DERIVED_ADVISORY_RULES.length);
        expect(result.detectorCoverage.find(({ rule }) => rule === 'HotPartitionRisk')).toEqual(
            entry('HotPartitionRisk'),
        );
    });

    it('distinguishes matches, negative evaluations, inapplicability and insufficient evidence in one rule', () => {
        const inputs = {
            ...emptyInputs,
            partitions: [
                partition(),
                partition({ maxP99: 50 }),
                partition({ partitionCount: 1 }),
                partition({ resourceAgeDays: 0.5 }),
            ],
        };
        const result = analyzeDerivedAdvisories(inputs, DEFAULT_ADVISORY_THRESHOLDS);

        expect(result.detectorCoverage.find(({ rule }) => rule === 'HotPartitionRisk')).toEqual(
            entry('HotPartitionRisk', {
                status: 'partial',
                evaluatedCount: 2,
                matchedCount: 1,
                notApplicableCount: 1,
                insufficientDataCount: 1,
            }),
        );
        expect(result.advisories.filter(({ rule }) => rule === 'HotPartitionRisk')).toHaveLength(1);
        expect(computeDerivedAdvisories(inputs, DEFAULT_ADVISORY_THRESHOLDS)).toEqual(result.advisories);
        expect(JSON.stringify(result.detectorCoverage)).not.toContain('private-');
    });

    it('retains the finding-only API without accumulating mutable state across analyses', () => {
        const ctx = { inputs: { ...emptyInputs, partitions: [partition()] }, thresholds: DEFAULT_ADVISORY_THRESHOLDS };

        for (const detector of DETECTORS) {
            const first = detector.analyze(ctx);

            expect(detector.run(ctx)).toEqual(first.advisories);
            first.coverage.evaluatedCount = 1000;
            expect(detector.analyze(ctx).coverage.evaluatedCount).not.toBe(1000);
        }
    });

    it('counts insufficient sample history instead of treating absent findings as negative results', () => {
        const result = analyzeDerivedAdvisories(
            {
                ...emptyInputs,
                manualThroughput: [
                    {
                        databaseId: 'private-db',
                        containerId: 'private-container',
                        provisionedRu: 1000,
                        ruPercents: [10],
                        resourceAgeDays: 30,
                    },
                ],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );

        for (const rule of ['OverProvisioning', 'AutoscaleCandidate']) {
            expect(result.detectorCoverage.find((coverage) => coverage.rule === rule)).toMatchObject({
                status: 'insufficientData',
                evaluatedCount: 0,
                matchedCount: 0,
                insufficientDataCount: 1,
            });
        }
    });

    it.each([
        { rule: 'StorageGrowthRisk', sizes: [[0.5], [30]], status: 'insufficientData', matches: 0 },
        { rule: 'StorageGrowthRisk', sizes: [[30, 30], [30]], status: 'insufficientData', matches: 0 },
        { rule: 'StorageGrowthRisk', sizes: [[10, 10.1], []], status: 'insufficientData', matches: 0 },
        { rule: 'StorageGrowthRisk', sizes: [[30, 30], [0.5]], status: 'evaluated', matches: 0 },
        { rule: 'StorageGrowthRisk', sizes: [[45, 46], []], status: 'evaluated', matches: 1 },
        { rule: 'StorageSkewRisk', sizes: [[30], [30], []], status: 'insufficientData', matches: 0 },
        { rule: 'StorageSkewRisk', sizes: [[0.5], [0.1], []], status: 'insufficientData', matches: 0 },
        { rule: 'StorageSkewRisk', sizes: [[30], [30]], status: 'evaluated', matches: 0 },
        { rule: 'StorageSkewRisk', sizes: [[30]], status: 'notApplicable', matches: 0 },
        { rule: 'StorageSkewRisk', sizes: [[40], [5], []], status: 'evaluated', matches: 1 },
    ] satisfies {
        rule: DerivedAdvisoryRule;
        sizes: number[][];
        status: DetectorCoverage['status'];
        matches: number;
    }[])('reports $rule coverage with partition histories $sizes as $status', ({ rule, sizes, status, matches }) => {
        const result = analyzeDerivedAdvisories(
            {
                ...emptyInputs,
                storage: [
                    {
                        databaseId: 'private-db',
                        containerId: 'private-container',
                        resourceAgeDays: 30,
                        partitions: sizes.map((values, index) => ({
                            partitionId: String(index),
                            samples: values.map((value, day) => ({ timestamp: day * DAY, bytes: value * GB })),
                        })),
                    },
                ],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );

        expect(result.detectorCoverage.find((coverage) => coverage.rule === rule)).toMatchObject({
            status,
            evaluatedCount: status === 'evaluated' ? 1 : 0,
            matchedCount: matches,
            insufficientDataCount: status === 'insufficientData' ? 1 : 0,
        });
        expect(result.advisories.filter((advisory) => advisory.rule === rule)).toHaveLength(matches);
    });

    it('counts findings before supersession without changing their visibility decisions', () => {
        const result = analyzeDerivedAdvisories(
            {
                ...emptyInputs,
                scopeProvisionedRuTotal: 10000,
                manualThroughput: [
                    {
                        databaseId: 'private-db',
                        containerId: 'private-container',
                        provisionedRu: 10000,
                        ruPercents: Array<number>(24).fill(5),
                        resourceAgeDays: 30,
                    },
                ],
                idleContainers: [
                    {
                        databaseId: 'private-db',
                        containerId: 'private-container',
                        provisionedRu: 10000,
                        peakRuPerBucket: 0,
                        throughputMode: 'dedicated',
                        resourceAgeDays: 30,
                    },
                ],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );

        expect(result.advisories.find(({ rule }) => rule === 'OverProvisioning')?.supersededBy).toBe('IdleContainer');
        for (const rule of ['OverProvisioning', 'IdleContainer']) {
            expect(result.detectorCoverage.find((coverage) => coverage.rule === rule)).toMatchObject({
                evaluatedCount: 1,
                matchedCount: 1,
            });
        }
    });
});

describe('detector dependency coverage', () => {
    it('preserves partial per-rule success and deduplicates reasons without forwarding scopes', () => {
        const result = completeDetectorCoverage(
            [entry('HotPartitionRisk', { status: 'evaluated', evaluatedCount: 1, matchedCount: 1 })],
            {
                metricSource: {
                    available: false,
                    failures: [
                        { rule: 'HotPartitionRisk', scope: 'private-db/first', reason: 'rbac' },
                        { rule: 'HotPartitionRisk', scope: 'private-db/second', reason: 'rbac' },
                        { rule: 'HotPartitionRisk', scope: 'private-db/third', reason: 'noData' },
                    ],
                },
                logSource: { available: true },
            },
        );

        expect(result).toEqual([
            entry('HotPartitionRisk', {
                status: 'partial',
                evaluatedCount: 1,
                matchedCount: 1,
                unavailableReasons: ['noData', 'rbac'],
            }),
        ]);
        expect(JSON.stringify(result)).not.toContain('private-');
    });

    describe('main collector coverage integration', () => {
        afterEach(() => vi.restoreAllMocks());

        it('keeps evaluated known targets partial when another row has unknown eligibility', async () => {
            const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
            const known = inventoryRow();
            const unknown = inventoryRow({
                containerId: 'private-unknown',
                throughputMode: 'unknown',
                throughputRU: undefined,
                offerLevel: undefined,
                offerThroughputMode: 'unknown',
            });

            vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({});
            vi.spyOn(inventory, 'getSqlInventoryDetails').mockResolvedValue({
                rows: [known, unknown],
                offers: [],
                databases: [],
            });
            vi.spyOn(metrics, 'getContainerIdlePeak').mockResolvedValue(0);

            const result = await collectDerivedAdvisories({
                monitorClient: mockClient({}),
                cosmosClient,
                accountId: 'private-account',
                resourceGroup: 'private-rg',
                accountName: 'private-account',
                isServerless: false,
                advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
            });

            expect(result.detectorCoverage.find(({ rule }) => rule === 'IdleContainer')).toMatchObject({
                status: 'partial',
                evaluatedCount: 1,
                matchedCount: 1,
                insufficientDataCount: 0,
                unavailableReasons: [],
            });
            expect(result.advisories.some(({ rule }) => rule === 'IdleContainer')).toBe(true);
            expect(JSON.stringify(result.detectorCoverage)).not.toContain('private-');
        });

        it.each(['containerDate', 'offerDate', 'discoveredDate', 'accountFallback', 'unknown', 'idleFailure'] as const)(
            'attributes age failures only when needed by the target (%s)',
            async (state) => {
                const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
                const createdAt = '2020-01-01T00:00:00.000Z';
                const row = inventoryRow({
                    resourceCreatedAt: state === 'containerDate' || state === 'idleFailure' ? createdAt : undefined,
                    offerCreatedAt: state === 'offerDate' ? createdAt : undefined,
                });
                const getAccount = vi.spyOn(cosmosClient.databaseAccounts, 'get');

                if (state === 'accountFallback') {
                    getAccount.mockResolvedValue({ systemData: { createdAt: new Date(createdAt) } });
                } else {
                    getAccount.mockRejectedValue(Object.assign(new Error('private-age-error'), { statusCode: 403 }));
                }
                vi.spyOn(inventory, 'getSqlInventoryDetails').mockResolvedValue({
                    rows: [row],
                    offers: [],
                    databases: [],
                });
                const getContainerAge = vi.spyOn(resourceAge, 'getContainerCreatedAt');
                if (state === 'accountFallback') {
                    getContainerAge.mockRejectedValue(
                        Object.assign(new Error('private-container-age-error'), { statusCode: 503 }),
                    );
                } else {
                    getContainerAge.mockResolvedValue(state === 'discoveredDate' ? createdAt : undefined);
                }
                const getIdle = vi.spyOn(metrics, 'getContainerIdlePeak');
                if (state === 'idleFailure') {
                    getIdle.mockRejectedValue(Object.assign(new Error('private-idle-error'), { statusCode: 403 }));
                } else {
                    getIdle.mockResolvedValue(0);
                }

                const result = await collectDerivedAdvisories({
                    monitorClient: mockClient({}),
                    cosmosClient,
                    accountId: 'private-account',
                    resourceGroup: 'private-rg',
                    accountName: 'private-account',
                    isServerless: false,
                    advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
                });

                expect(result.detectorCoverage.find(({ rule }) => rule === 'IdleContainer')).toMatchObject({
                    status: state === 'unknown' ? 'partial' : state === 'idleFailure' ? 'unavailable' : 'evaluated',
                    evaluatedCount: state === 'idleFailure' ? 0 : 1,
                    unavailableReasons: state === 'unknown' || state === 'idleFailure' ? ['rbac'] : [],
                });
                expect(result.metricSource.available).toBe(false);
                expect(result.metricSource.failures).toContainEqual({
                    rule: 'IdleContainer',
                    reason: state === 'accountFallback' ? 'noData' : 'rbac',
                    scope: state === 'accountFallback' ? 'private-db/private-container' : undefined,
                });
            },
        );

        it.each([403, 503, 'empty', 'excluded'] as const)(
            'preserves index-read failure reasons without treating successful empty reads as failures (%s)',
            async (state) => {
                const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
                const row = inventoryRow({
                    throughputMode: 'serverless',
                    throughputRU: undefined,
                    offerLevel: 'none',
                    offerThroughputMode: 'serverless',
                    userExcludedPathCount: state === 'excluded' ? 1 : 0,
                });
                const monitorClient = mockClient({
                    DataUsage: {
                        value: [
                            {
                                timeseries: [
                                    {
                                        metadatavalues: dims(row.databaseId, row.containerId),
                                        data: [{ timeStamp: iso(Date.now()), maximum: 100 }],
                                    },
                                ],
                            },
                        ],
                    },
                });
                const list = monitorClient.metrics.list.bind(monitorClient.metrics);

                vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({});
                vi.spyOn(inventory, 'getSqlInventoryDetails').mockResolvedValue({
                    rows: [row],
                    offers: [],
                    databases: [],
                });
                vi.spyOn(monitorClient.metrics, 'list').mockImplementation((resource, options) =>
                    options?.metricnames === 'IndexUsage' && state !== 'empty'
                        ? Promise.reject(
                              Object.assign(new Error('private-index-error'), {
                                  statusCode: state === 503 ? 503 : 403,
                              }),
                          )
                        : list(resource, options),
                );

                const captured = await withReadDiagnostics(() =>
                    collectDerivedAdvisories({
                        monitorClient,
                        cosmosClient,
                        accountId: 'private-account',
                        resourceGroup: 'private-rg',
                        accountName: 'private-account',
                        isServerless: true,
                        advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
                    }),
                );
                const result = captured.result;

                expect(result.detectorCoverage.find(({ rule }) => rule === 'IndexingCostRisk')).toMatchObject({
                    status:
                        state === 'empty' ? 'insufficientData' : state === 'excluded' ? 'notApplicable' : 'unavailable',
                    evaluatedCount: 0,
                    unavailableReasons:
                        state === 'empty' || state === 'excluded' ? [] : [state === 403 ? 'rbac' : 'noData'],
                });
                expect(result.metricSource).toEqual({ available: true, failures: [] });
                expect(result.advisories).toEqual([]);
                expect(captured.diagnostics.filter(({ source }) => source === 'metrics')).toEqual(
                    state === 'empty'
                        ? []
                        : [
                              {
                                  source: 'metrics',
                                  kind: state === 503 ? 'transient' : 'accessDenied',
                                  reason: state === 503 ? 'noData' : 'rbac',
                              },
                          ],
                );
                expect(JSON.stringify(result.detectorCoverage)).not.toContain('private-');
            },
        );

        it.each(['empty', 'unknown', 'failed', 'missingOffer', 'nonfiniteRu', 'zeroRu'] as const)(
            'does not confuse %s inventory with an authoritative empty target set',
            async (state) => {
                const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
                const getInventory = vi.spyOn(inventory, 'getSqlInventoryDetails');

                vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({});
                if (state === 'failed') {
                    getInventory.mockRejectedValue(Object.assign(new Error('private-inventory'), { statusCode: 403 }));
                } else {
                    getInventory.mockResolvedValue({
                        offers: [],
                        databases: [],
                        rows:
                            state === 'empty'
                                ? []
                                : [
                                      {
                                          databaseId: 'private-db',
                                          containerId: 'private-container',
                                          throughputMode: state === 'unknown' ? 'unknown' : 'dedicated',
                                          throughputRU:
                                              state === 'unknown'
                                                  ? undefined
                                                  : state === 'nonfiniteRu'
                                                    ? Number.NaN
                                                    : state === 'zeroRu'
                                                      ? 0
                                                      : 1000,
                                          offerLevel: state === 'missingOffer' ? undefined : 'container',
                                          offerThroughputMode: state === 'unknown' ? 'unknown' : 'manual',
                                          partitionKeyPaths: [],
                                          indexingMode: 'consistent',
                                          excludedPathCount: 0,
                                          userExcludedPathCount: 0,
                                          compositeIndexCount: 0,
                                          health: 'Healthy',
                                      },
                                  ],
                    });
                }

                const captured = await withReadDiagnostics(() =>
                    collectDerivedAdvisories({
                        monitorClient: mockClient({}),
                        cosmosClient,
                        accountId: 'private-account',
                        resourceGroup: 'private-rg',
                        accountName: 'private-account',
                        isServerless: false,
                        advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
                        accountConfig: {
                            accountName: 'private-account',
                            consistencyLevel: 'Strong',
                            regionCount: 2,
                            multiRegionWritesEnabled: false,
                            writeRegionCount: 1,
                            api: API.Core,
                        },
                    }),
                );
                const coverage = captured.result.detectorCoverage;

                expect(coverage).toHaveLength(19);
                expect(coverage.find(({ rule }) => rule === 'HotPartitionRisk')).toMatchObject({
                    status:
                        state === 'empty' ? 'notApplicable' : state === 'failed' ? 'unavailable' : 'insufficientData',
                    evaluatedCount: 0,
                });
                expect(coverage.find(({ rule }) => rule === 'ExpensiveConsistency')).toMatchObject({
                    status: 'evaluated',
                    matchedCount: 1,
                });
                expect(JSON.stringify({ coverage, diagnostics: captured.diagnostics })).not.toContain('private-');
            },
        );
    });

    it('distinguishes failed inventory from an authoritative empty target set without fabricating counts', () => {
        const coverage = [entry('HotPartitionRisk')];
        const sources = {
            metricSource: {
                available: false,
                failures: [{ rule: 'HotPartitionRisk', reason: 'rbac' }],
            },
            logSource: { available: true },
        } as const;
        const unavailable = completeDetectorCoverage(coverage, {
            ...sources,
            metricSource: { ...sources.metricSource, failures: [...sources.metricSource.failures] },
        });
        const noTargets = completeDetectorCoverage(coverage, {
            metricSource: { available: true, failures: [] },
            logSource: { available: true },
            targetCounts: { HotPartitionRisk: 0 },
        });

        expect(unavailable).toEqual([
            entry('HotPartitionRisk', {
                status: 'unavailable',
                unavailableReasons: ['rbac'],
            }),
        ]);
        expect(noTargets).toEqual([entry('HotPartitionRisk', { status: 'notApplicable' })]);
        expect(coverage).toEqual([entry('HotPartitionRisk')]);
    });

    it('keeps known targets with missing observations partial or insufficient, without counting nonexistent evaluations', () => {
        const result = completeDetectorCoverage(
            [entry('UncontrolledIngestion', { status: 'evaluated', evaluatedCount: 1 }), entry('CrossPartitionQuery')],
            {
                metricSource: { available: true, failures: [] },
                logSource: { available: true },
                targetCounts: { UncontrolledIngestion: 2, CrossPartitionQuery: 2 },
            },
        );

        expect(result).toEqual([
            entry('UncontrolledIngestion', { status: 'partial', evaluatedCount: 1 }),
            entry('CrossPartitionQuery'),
        ]);
    });

    it.each([
        [
            'client',
            ['CrossPartitionQuery', 'ShardKeyMisalignment', 'UncontrolledIngestion', 'SharedThroughputStarvation'],
        ],
        ['probeQueryRuntime', ['CrossPartitionQuery', 'ShardKeyMisalignment']],
        ['crossPartition', ['CrossPartitionQuery', 'ShardKeyMisalignment']],
        ['ingestionSummary', ['UncontrolledIngestion']],
        ['ingestionBurst', ['UncontrolledIngestion']],
        ['ingestionUserAgent', ['UncontrolledIngestion']],
        ['sharedThroughput', ['SharedThroughputStarvation']],
        ['probeDataPlane', ['UncontrolledIngestion', 'SharedThroughputStarvation']],
    ] satisfies [LogsOperation, DerivedAdvisoryRule[]][])(
        'attributes %s failures only to dependent rules',
        (operation, rules) => {
            const result = completeDetectorCoverage(
                DERIVED_ADVISORY_RULES.map((rule) => entry(rule)),
                {
                    metricSource: { available: true, failures: [] },
                    logSource: {
                        available: false,
                        reason: 'rbac',
                        failures: [{ operation, reason: 'rbac', kind: 'accessDenied' }],
                    },
                },
            );

            expect(
                result
                    .filter(({ status }) => status === 'unavailable')
                    .map(({ rule }) => rule)
                    .sort(),
            ).toEqual([...rules].sort());
        },
    );

    it('does not let unrelated log or cost availability suppress completed configuration checks', () => {
        const result = completeDetectorCoverage(
            [
                entry('ExpensiveConsistency', { status: 'evaluated', evaluatedCount: 1, matchedCount: 1 }),
                entry('CrossPartitionQuery'),
            ],
            {
                metricSource: { available: true, failures: [] },
                logSource: { available: false, reason: 'logAnalyticsDisabled' },
            },
        );

        expect(result[0]).toEqual(
            entry('ExpensiveConsistency', {
                status: 'evaluated',
                evaluatedCount: 1,
                matchedCount: 1,
            }),
        );
        expect(result[1]).toEqual(
            entry('CrossPartitionQuery', {
                status: 'unavailable',
                unavailableReasons: ['logAnalyticsDisabled'],
            }),
        );
    });

    it('keeps missing ARM fields as insufficient evidence instead of failed workload reads', () => {
        const coverage = entry('ExpensiveConsistency', { insufficientDataCount: 1 });
        const result = completeDetectorCoverage([coverage], {
            metricSource: {
                available: false,
                failures: [{ rule: 'ExpensiveConsistency', reason: 'noData' }],
            },
            logSource: { available: false, reason: 'rbac' },
        });

        expect(result).toEqual([coverage]);
    });
});
