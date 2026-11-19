/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import * as inventory from '../inventory';
import * as partitionHealth from '../partitionHealth';
import { withReadDiagnostics } from '../readDiagnostics';
import * as resourceAge from '../resourceAge';
import { GB, mockClient } from '../testFixtures';
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

describe('pure detector coverage', () => {
    it.each([undefined, 0.1, 30])('does not require age for a known single partition (%s days)', (resourceAgeDays) => {
        const result = analyzeDerivedAdvisories(
            {
                ...emptyInputs,
                partitions: [partition({ partitionCount: 1, resourceAgeDays })],
                storage: [
                    {
                        databaseId: 'private-db',
                        containerId: 'private-container',
                        resourceAgeDays,
                        partitions: [{ partitionId: '0', samples: [{ timestamp: 0, bytes: GB }] }],
                    },
                ],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );

        for (const rule of ['HotPartitionRisk', 'StorageSkewRisk']) {
            expect(result.detectorCoverage.find((entry) => entry.rule === rule)).toMatchObject({
                status: 'notApplicable',
                notApplicableCount: 1,
                evaluatedCount: 0,
                unavailableReasons: [],
            });
        }
        expect(
            result.advisories.filter(({ rule }) => rule === 'HotPartitionRisk' || rule === 'StorageSkewRisk'),
        ).toEqual([]);
    });

    it('does not evaluate partition findings from missing throttling evidence', () => {
        const result = analyzeDerivedAdvisories(
            {
                ...emptyInputs,
                partitions: [partition({ throttleRatePercent: undefined, totalRequests: undefined })],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );

        for (const rule of ['HotPartitionRisk', 'SustainedThrottlingInRegion']) {
            expect(result.detectorCoverage.find((entry) => entry.rule === rule)).toMatchObject({
                status: 'insufficientData',
                evaluatedCount: 0,
                matchedCount: 0,
            });
        }
        expect(result.advisories).toEqual([]);
    });

    it.each([0, 1, 2])('treats known low query fan-out as a completed negative evaluation (%s)', (fanout) => {
        const result = analyzeDerivedAdvisories(
            {
                ...emptyInputs,
                crossPartition: [
                    {
                        databaseId: 'private-db',
                        containerId: 'private-container',
                        evaluationWindowSeconds: 300,
                        shapes: [
                            {
                                text: 'private-query',
                                executions: 10000,
                                avgFanout: Math.min(fanout, 1),
                                maxFanout: fanout,
                            },
                        ],
                    },
                ],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );

        for (const rule of ['CrossPartitionQuery', 'ShardKeyMisalignment']) {
            expect(result.detectorCoverage.find((entry) => entry.rule === rule)).toMatchObject({
                status: fanout > 0 ? 'evaluated' : 'insufficientData',
                evaluatedCount: fanout > 0 ? 1 : 0,
                notApplicableCount: 0,
                matchedCount: 0,
            });
        }
    });

    it.each([
        { consistencyLevel: 'Session', regionCount: 0, status: 'notApplicable' },
        { consistencyLevel: 'Eventual', regionCount: 0, status: 'notApplicable' },
        { consistencyLevel: undefined, regionCount: 1, status: 'insufficientData' },
        { consistencyLevel: undefined, regionCount: 0, status: 'insufficientData' },
        { consistencyLevel: 'Strong', regionCount: 1, status: 'evaluated' },
        { consistencyLevel: 'BoundedStaleness', regionCount: 1, status: 'notApplicable' },
    ])('preserves the original consistency eligibility: %j', ({ consistencyLevel, regionCount, status }) => {
        const result = analyzeDerivedAdvisories(
            {
                ...emptyInputs,
                accountConfig: {
                    accountName: 'private-account',
                    consistencyLevel,
                    regionCount,
                    multiRegionWritesEnabled: false,
                    writeRegionCount: 1,
                    api: API.Core,
                },
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );

        expect(result.detectorCoverage.find(({ rule }) => rule === 'ExpensiveConsistency')).toMatchObject({ status });
    });

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
        { rule: 'StorageSkewRisk', sizes: [[30], []], status: 'insufficientData', matches: 0 },
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
    describe('collected required-read evidence', () => {
        afterEach(() => vi.restoreAllMocks());

        function row(overrides: Partial<inventory.InventoryContainerRow> = {}): inventory.InventoryContainerRow {
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

        function setup(target: inventory.InventoryContainerRow) {
            const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
            const monitorClient = mockClient({});

            vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({});
            vi.spyOn(inventory, 'getSqlInventoryDetails').mockResolvedValue({
                rows: [target],
                databases: [target.databaseId],
                throughputInventoryComplete: true,
                offers: [
                    {
                        databaseId: target.databaseId,
                        containerId: target.containerId,
                        offerLevel: 'container',
                        throughputMode: target.throughputMode,
                        offerThroughputMode: target.offerThroughputMode === 'autoscale' ? 'autoscale' : 'manual',
                        throughputRU: 1000,
                        resourceCreatedAt: target.resourceCreatedAt,
                    },
                ],
            });
            return {
                monitorClient,
                cosmosClient,
                accountId: 'private-account',
                resourceGroup: 'private-rg',
                accountName: 'private-account',
                isServerless: false,
                advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
            };
        }

        it.each([1, 2])(
            'keeps applicability separate from failed throttle and age reads (%s partitions)',
            async (count) => {
                const params = setup(row({ resourceCreatedAt: undefined }));
                const rejected = Object.assign(new Error('private-error'), { statusCode: 403 });

                vi.mocked(params.cosmosClient.databaseAccounts.get).mockRejectedValue(rejected);
                vi.spyOn(resourceAge, 'getContainerCreatedAt').mockRejectedValue(rejected);
                vi.spyOn(partitionHealth, 'getPartitionHealth').mockResolvedValue({
                    available: true,
                    mode: 'ru',
                    databaseId: 'private-db',
                    containerId: 'private-container',
                    tiles: [],
                    skewScore: 0,
                    topPartitionShare: 95,
                    maxSaturationPercent: 95,
                    minSaturationPercent: 95,
                    partitionCount: count,
                    topN: 5,
                    generatedAt: 0,
                });
                vi.spyOn(partitionHealth, 'getPartitionStorageSeries').mockResolvedValue({
                    available: true,
                    databaseId: 'private-db',
                    containerId: 'private-container',
                    generatedAt: 0,
                    partitions: Array.from({ length: count }, (_, index) => ({
                        partitionId: String(index),
                        samples: [{ timestamp: 0, bytes: GB }],
                    })),
                });
                vi.spyOn(params.monitorClient.metrics, 'list').mockImplementation(async (_resource, options) => {
                    if (options?.metricnames === 'TotalRequests') {
                        throw rejected;
                    }
                    return { cost: 0, timespan: 'window', value: [] };
                });
                const result = await collectDerivedAdvisories(params);

                for (const rule of ['HotPartitionRisk', 'StorageSkewRisk']) {
                    expect(result.detectorCoverage.find((entry) => entry.rule === rule)).toMatchObject({
                        status: count === 1 ? 'notApplicable' : rule === 'HotPartitionRisk' ? 'unavailable' : 'partial',
                        notApplicableCount: count === 1 ? 1 : 0,
                        evaluatedCount: count === 2 && rule === 'StorageSkewRisk' ? 1 : 0,
                        matchedCount: 0,
                        unavailableReasons: count === 1 ? [] : ['rbac'],
                    });
                    expect(result.metricSource.failures).toContainEqual({ rule, scope: undefined, reason: 'rbac' });
                }
                expect(
                    result.detectorCoverage.find(({ rule }) => rule === 'SustainedThrottlingInRegion'),
                ).toMatchObject({
                    evaluatedCount: 0,
                    matchedCount: 0,
                    unavailableReasons: ['rbac'],
                });
                expect(result.metricSource.failures).toContainEqual({
                    rule: 'HotPartitionRisk',
                    scope: 'private-db/private-container',
                    reason: 'rbac',
                });
                expect(result.advisories.map(({ rule }) => rule)).toEqual(['IdleContainer']);
            },
        );

        it.each([
            ['manual', 'empty'],
            ['autoscale', 'empty'],
            ['manual', 403],
            ['autoscale', 503],
            ['manual', 'optionalFailure'],
            ['autoscale', 'optionalFailure'],
        ] as const)('separates empty observations from failed reads for %s offers (%s)', async (mode, state) => {
            const params = setup(row({ offerThroughputMode: mode }));

            vi.spyOn(params.monitorClient.metrics, 'list').mockImplementation(async (_resource, options) => {
                if (
                    typeof state === 'number' ||
                    (state === 'optionalFailure' && options?.metricnames === 'TotalRequests')
                ) {
                    throw Object.assign(new Error('private-metric-error'), {
                        statusCode: typeof state === 'number' ? state : 403,
                    });
                }
                return { cost: 0, timespan: 'window', value: [] };
            });
            const result = await withReadDiagnostics('metrics', ['private-account'], vi.fn(), () =>
                collectDerivedAdvisories(params),
            );
            const rules = [
                'IndexingCostRisk',
                'StorageGrowthRisk',
                'StorageSkewRisk',
                'PartitionMergeCandidate',
                ...(mode === 'manual'
                    ? ['OverProvisioning', 'AutoscaleCandidate']
                    : ['AutoscaleMaxOverProvisioned', 'AutoscaleToManualCandidate']),
            ];

            for (const rule of rules) {
                expect(result.detectorCoverage.find((entry) => entry.rule === rule)).toMatchObject({
                    status: typeof state === 'number' ? 'unavailable' : 'insufficientData',
                    unavailableReasons: typeof state === 'number' ? [state === 403 ? 'rbac' : 'noData'] : [],
                });
            }
            expect(result.detectorCoverage.find(({ rule }) => rule === 'IdleContainer')).toMatchObject({
                status: typeof state === 'number' ? 'unavailable' : 'evaluated',
                matchedCount: typeof state === 'number' ? 0 : 1,
                unavailableReasons: typeof state === 'number' ? [state === 403 ? 'rbac' : 'noData'] : [],
            });
            expect(result.metricSource.available).toBe(false);
            expect(result.metricSource.failures).toContainEqual({
                rule: 'IndexingCostRisk',
                scope: 'private-db/private-container',
                reason: state === 403 ? 'rbac' : 'noData',
            });
            expect(result.advisories.map(({ rule }) => rule)).toEqual(
                typeof state === 'number' ? [] : ['IdleContainer'],
            );
            expect(JSON.stringify(result.detectorCoverage)).not.toContain('private-');
        });

        it.each(['DataUsage', 'IndexUsage'])(
            'preserves indexing failure coverage despite user exclusions when %s fails',
            async (metric) => {
                const params = setup(row({ userExcludedPathCount: 1 }));

                vi.spyOn(params.monitorClient.metrics, 'list').mockImplementation(async (_resource, options) => {
                    if (options?.metricnames === metric) {
                        throw Object.assign(new Error('private-primary-error'), { statusCode: 403 });
                    }
                    return { cost: 0, timespan: 'window', value: [] };
                });
                const result = await collectDerivedAdvisories(params);

                expect(result.detectorCoverage.find(({ rule }) => rule === 'IndexingCostRisk')).toMatchObject({
                    status: 'unavailable',
                    notApplicableCount: 0,
                    unavailableReasons: ['rbac'],
                });
                expect(result.metricSource.failures).toContainEqual({
                    rule: 'IndexingCostRisk',
                    scope: 'private-db/private-container',
                    reason: 'rbac',
                });
                expect(result.advisories.filter(({ rule }) => rule === 'IndexingCostRisk')).toEqual([]);
            },
        );

        it('retains disabled-indexing inapplicability without requiring index metrics', async () => {
            const params = setup(row({ indexingMode: 'none' }));
            const readIndexing = vi.spyOn(metrics, 'getContainerIndexingUsage');

            const result = await collectDerivedAdvisories(params);

            expect(result.detectorCoverage.find(({ rule }) => rule === 'IndexingCostRisk')).toMatchObject({
                status: 'notApplicable',
                unavailableReasons: [],
            });
            expect(readIndexing).not.toHaveBeenCalled();
            expect(result.metricSource.failures.filter(({ rule }) => rule === 'IndexingCostRisk')).toEqual([]);
        });

        it.each([1, 2])('retains a known partition count when merge storage fails (%s)', async (count) => {
            const params = setup(row());

            vi.spyOn(metrics, 'getContainerPartitionCount').mockResolvedValue(count);
            vi.spyOn(metrics, 'getContainerMergeStoragePeak').mockRejectedValue({ statusCode: 503 });
            const result = await collectDerivedAdvisories(params);

            expect(result.detectorCoverage.find(({ rule }) => rule === 'PartitionMergeCandidate')).toMatchObject({
                status: count === 1 ? 'notApplicable' : 'unavailable',
                notApplicableCount: count === 1 ? 1 : 0,
                unavailableReasons: count === 1 ? [] : ['noData'],
            });
            expect(result.metricSource.failures).toContainEqual({
                rule: 'PartitionMergeCandidate',
                scope: 'private-db/private-container',
                reason: 'noData',
            });
        });
    });

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
        ['probeDataPlane5M', ['UncontrolledIngestion', 'SharedThroughputStarvation']],
        ['crossPartitionRu', []],
        ['consistencyReadRu', []],
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
        const coverage = entry('PaidContinuousBackup', { insufficientDataCount: 1 });
        const result = completeDetectorCoverage([coverage], {
            metricSource: {
                available: false,
                failures: [{ rule: 'PaidContinuousBackup', reason: 'noData' }],
            },
            logSource: { available: false, reason: 'rbac' },
        });

        expect(result).toEqual([coverage]);
    });
});
