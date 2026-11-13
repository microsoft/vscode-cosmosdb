/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogsQueryResultStatus } from '@azure/monitor-query-logs';
import assert from 'node:assert/strict';
import { getPartitionStorageSeries } from '../../partitionHealth';
import { getThrottleRate } from '../../ruTrends';
import { DEFAULT_ADVISORY_THRESHOLDS, DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type DerivedAdvisoryRule } from '../core/types';
import { autoscaleCandidateDetector } from '../detectors/AutoscaleCandidateDetector';
import { autoscaleToManualCandidateDetector } from '../detectors/AutoscaleToManualCandidateDetector';
import { crossPartitionQueryDetector } from '../detectors/CrossPartitionQueryDetector';
import { expensiveConsistencyDetector } from '../detectors/ExpensiveConsistencyDetector';
import { hotPartitionRiskDetector } from '../detectors/HotPartitionRiskDetector';
import { idleContainerDetector } from '../detectors/IdleContainerDetector';
import { indexingCostRiskDetector } from '../detectors/IndexingCostRiskDetector';
import { multiRegionWriteAntipatternDetector } from '../detectors/MultiRegionWriteAntipatternDetector';
import { paidContinuousBackupDetector } from '../detectors/PaidContinuousBackupDetector';
import { partitionMergeCandidateDetector } from '../detectors/PartitionMergeCandidateDetector';
import { perRegionAutoscaleCandidateDetector } from '../detectors/PerRegionAutoscaleCandidateDetector';
import { reservedCapacityCandidateDetector } from '../detectors/ReservedCapacityCandidateDetector';
import { serverlessCandidateDetector } from '../detectors/ServerlessCandidateDetector';
import { serverlessThrottlingDetector } from '../detectors/ServerlessThrottlingDetector';
import { shardKeyMisalignmentDetector } from '../detectors/ShardKeyMisalignmentDetector';
import { sharedThroughputStarvationDetector } from '../detectors/SharedThroughputStarvationDetector';
import { storageGrowthRiskDetector } from '../detectors/StorageGrowthRiskDetector';
import { storageSkewRiskDetector } from '../detectors/StorageSkewRiskDetector';
import { throttlingByOperationDetector } from '../detectors/ThrottlingByOperationDetector';
import { uncontrolledIngestionDetector } from '../detectors/UncontrolledIngestionDetector';
import { underProvisioningDetector } from '../detectors/UnderProvisioningDetector';
import {
    fetchCrossPartitionShapes,
    fetchSharedThroughputTraffic,
    fetchUncontrolledIngestion,
    type LogsQueryExecutor,
} from '../fetchers/logs';
import { LogsFetchError } from '../fetchers/logsDiagnostics';
import {
    getAccountConsumedRuShape,
    getAutoscaleUtilization,
    getContainerIdlePeak,
    getContainerIndexingUsage,
} from '../fetchers/metrics';
import { metricResponse, withMetrics } from './metricsFixture';
import { near, number, observation, observed, type Binding, type World } from './shared';

const scope = { databaseId: 'fixture-db', containerId: 'fixture-container' };
const thresholds = DEFAULT_ADVISORY_THRESHOLDS;

export const ADDITIONAL_RULES: Readonly<Record<string, DerivedAdvisoryRule>> = {
    'DX-002': 'CrossPartitionQuery',
    'DX-003': 'SharedThroughputStarvation',
    'DX-004': 'IdleContainer',
    'DX-005': 'SustainedThrottlingInRegion',
    'DX-006': 'HotPartitionRisk',
    'DX-007': 'ShardKeyMisalignment',
    'DX-008': 'MultiRegionWriteAntipattern',
    'DX-009': 'PartitionMergeCandidate',
    'DX-010': 'UncontrolledIngestion',
    'DX-012': 'AutoscaleCandidate',
    'DX-013': 'AutoscaleToManualCandidate',
    'DX-014': 'ServerlessCandidate',
    'DX-015': 'StorageSkewRisk',
    'DX-016': 'ExpensiveConsistency',
    'DX-017': 'StorageGrowthRisk',
    'DX-018': 'ServerlessThrottling',
    'DX-019': 'PaidContinuousBackup',
    'DX-021': 'ThrottlingByOperation',
    'DX-022': 'PerRegionAutoscaleCandidate',
    'DX-023': 'ReservedCapacityCandidate',
    'DX-024': 'IndexingCostRisk',
};

async function evaluateLogs(world: World, detector: string): Promise<void> {
    let queries = 0;
    const executor: LogsQueryExecutor = {
        async queryResource(_resource, query) {
            queries++;
            if (world.logFailure) {
                throw Object.assign(new Error('Synthetic log acquisition failure.'), { statusCode: 403 });
            }
            let rows: Record<string, number | string>[] = [];
            if (!world.emptyLogs) {
                if (detector === 'DX-002' || detector === 'DX-007') {
                    rows = (world.queries?.shapes ?? []).map((shape) => ({
                        QueryText: shape.text,
                        executions: shape.executions,
                        avgFanout: shape.avgFanout,
                        maxFanout: shape.maxFanout,
                    }));
                } else if (detector === 'DX-003') {
                    rows = (world.shared?.collections ?? []).map((collection) => ({
                        CollectionName: collection.containerId,
                        requests: collection.requests,
                        throttled: collection.throttledRequests,
                        ru: collection.ruConsumed,
                    }));
                } else if (query.includes('totalRu')) {
                    assert.ok(world.requests);
                    rows = [
                        {
                            writeRu: world.writeRu ?? 0,
                            totalRu: world.totalRu ?? 0,
                            reqs: world.requests.total,
                            throttles: world.requests.throttled,
                        },
                    ];
                }
            }
            const columns = Object.keys(rows[0] ?? {});
            return {
                status: LogsQueryResultStatus.Success,
                tables: [
                    {
                        name: 'PrimaryResult',
                        columnDescriptors: columns.map((name) => ({ name, type: 'string' })),
                        rows: rows.map((row) => columns.map((column) => row[column])),
                    },
                ],
            };
        },
    };
    const timespan = {
        startTime: new Date(0),
        endTime: new Date((world.queries?.evaluationWindowSeconds ?? 3600) * 1000),
    };
    try {
        if (detector === 'DX-002' || detector === 'DX-007') {
            const input = await fetchCrossPartitionShapes(
                executor,
                'fixture-account',
                scope.databaseId,
                scope.containerId,
                timespan,
            );
            world.inputs.crossPartition = [input];
            world.result =
                detector === 'DX-002'
                    ? crossPartitionQueryDetector.evaluateResult(input, {
                          minQueries: thresholds.crossPartitionMinQueries,
                          fanoutThreshold: thresholds.crossPartitionFanoutThreshold,
                          medPct: thresholds.crossPartitionMedPct,
                      })
                    : shardKeyMisalignmentDetector.evaluateResult(
                          input,
                          {
                              structuralPct: thresholds.shardKeyStructuralPct,
                              minPartitions: DIAGNOSTIC_POLICY.shardKey.minPartitions,
                          },
                          thresholds.crossPartitionFanoutThreshold,
                          thresholds.crossPartitionMinQueries,
                      );
        } else if (detector === 'DX-003') {
            assert.ok(world.shared);
            const traffic = await fetchSharedThroughputTraffic(
                executor,
                'fixture-account',
                scope.databaseId,
                world.shared.sharedRu,
                timespan,
            );
            const input = { ...traffic, sharedContainerIds: world.shared.sharedContainerIds };
            world.inputs.sharedThroughput = [input];
            world.result = sharedThroughputStarvationDetector.evaluateResult(input, {
                minRequests: thresholds.sharedThroughputMinRequests,
                poolThrottlePct: thresholds.sharedThroughputPoolThrottlePct,
                dominancePct: thresholds.sharedThroughputDominancePct,
                victimThrottlePct: thresholds.sharedThroughputVictimThrottlePct,
                victimSharePct: thresholds.sharedThroughputVictimSharePct,
            });
        } else {
            const input = await fetchUncontrolledIngestion(
                executor,
                'fixture-account',
                scope.databaseId,
                scope.containerId,
                timespan,
            );
            world.inputs.ingestion = input ? [input] : [];
            world.result = uncontrolledIngestionDetector.evaluateResult(input, {
                writeRuPctFloor: thresholds.ingestionWriteRuPctFloor,
                throttleRatePct: thresholds.ingestionThrottleRatePct,
                highPct: thresholds.ingestionHighPct,
                minRequests: thresholds.ingestionMinRequests,
            });
        }
    } catch (error) {
        if (!(error instanceof LogsFetchError)) {
            throw error;
        }
        assert.ok(queries > 0, 'An acquisition-error scenario must execute the production fetcher.');
        // CODA and the native collector name acquisition failures differently; neither is a clean verdict.
        world.result = {
            rootCause: detector === 'DX-002' || detector === 'DX-007' ? 'log_analytics_unavailable' : 'query_error',
        };
    }
}

export async function evaluateAdditional(world: World, detector: string): Promise<void> {
    if (['DX-002', 'DX-003', 'DX-007', 'DX-010'].includes(detector)) {
        await evaluateLogs(world, detector);
        return;
    }
    switch (detector) {
        case 'DX-004': {
            assert.ok(world.idle);
            const peak = world.idle.peakRuPerBucket;
            const observedPeak = await withMetrics(
                metricResponse('TotalRequestUnits', [peak === undefined ? [] : [peak]], 'total'),
                (client) =>
                    getContainerIdlePeak(
                        client,
                        'fixture-account',
                        scope.databaseId,
                        world.idle?.containerId,
                        undefined,
                        world.idle?.containerId === undefined ? [scope.containerId] : undefined,
                    ),
            );
            const input = { ...world.idle, peakRuPerBucket: observedPeak, resourceAgeDays: world.age };
            world.inputs.idleContainers = [input];
            world.result = idleContainerDetector.evaluateResult(
                input,
                thresholds.idlePeakRuPerBucket,
                world.inputs.scopeProvisionedRuTotal,
            );
            break;
        }
        case 'DX-005':
        case 'DX-006': {
            assert.ok(world.requests);
            const peaks = world.partitionPeaks ?? [];
            const input = {
                ...scope,
                maxP99: peaks.length > 0 ? Math.max(...peaks) : 0,
                minP99: peaks.length > 0 ? Math.min(...peaks) : 0,
                partitionCount: peaks.length,
                throttleRatePercent:
                    world.requests.total > 0 ? (100 * world.requests.throttled) / world.requests.total : 0,
                totalRequests: world.requests.total,
                throughputMode: world.requests.mode,
                resourceAgeDays: world.age,
            };
            world.inputs.partitions = [input];
            world.result =
                detector === 'DX-005'
                    ? underProvisioningDetector.evaluateResult(
                          input,
                          thresholds.partitionSaturationPercent,
                          thresholds.partitionHeadroomPercent,
                          thresholds.throttleRatePercent,
                      )
                    : hotPartitionRiskDetector.evaluateResult(
                          input,
                          thresholds.partitionSaturationPercent,
                          thresholds.partitionHeadroomPercent,
                          thresholds.throttleRatePercent,
                      );
            break;
        }
        case 'DX-008':
            world.inputs.accountConfig = world.account;
            world.result = multiRegionWriteAntipatternDetector.evaluateResult(
                world.account,
                world.inputs.manualRegionalCapacityRu,
            );
            break;
        case 'DX-009': {
            assert.ok(world.merge);
            const input = { ...world.merge, backupPolicy: world.account.backupPolicy };
            world.inputs.partitionMerges = [input];
            world.result = partitionMergeCandidateDetector.evaluateResult(input);
            break;
        }
        case 'DX-012': {
            assert.ok(world.manual);
            const input = { ...world.manual, resourceAgeDays: world.age };
            world.inputs.manualThroughput = [input];
            world.result = autoscaleCandidateDetector.evaluateResult(input, {
                maxPercent: thresholds.autoscaleMaxPercent,
                avgPercent: thresholds.autoscaleAvgPercent,
                peakToAvgRatio: thresholds.autoscalePeakToAvgRatio,
            });
            break;
        }
        case 'DX-013': {
            assert.ok(world.autoscale);
            const fixture = world.autoscale;
            const summary = await withMetrics(metricResponse('AutoscaledRU', fixture.series ?? []), (client) =>
                getAutoscaleUtilization(client, 'fixture-account', scope.databaseId, scope.containerId, fixture.max),
            );
            const input = { ...scope, ...summary, configuredMaxRu: fixture.max, resourceAgeDays: world.age };
            world.inputs.autoscaleUtilizations = [input];
            world.result = autoscaleToManualCandidateDetector.evaluateResult(
                input,
                thresholds.autoscaleToManualAvgPercent,
                thresholds.autoscaleToManualPeakToAvgRatio,
            );
            break;
        }
        case 'DX-014': {
            assert.ok(world.hourlyRu);
            const bucketSeconds = DIAGNOSTIC_POLICY.serverless.observation.bucketMs / 1000;
            const summary = await withMetrics(
                metricResponse('TotalRequestUnits', [world.hourlyRu.map((ru) => ru * bucketSeconds)], 'total'),
                (client) => getAccountConsumedRuShape(client, 'fixture-account'),
            );
            const input = { ...summary, isServerless: world.account.isServerless === true };
            world.inputs.serverless = input;
            world.result = serverlessCandidateDetector.evaluateResult(input, {
                sporadicRatio: thresholds.serverlessSporadicRatio,
                peakFloorRuPerSec: thresholds.serverlessPeakFloorRuPerSec,
                peakCeilingRuPerSec: thresholds.serverlessPeakCeilingRuPerSec,
            });
            break;
        }
        case 'DX-015':
        case 'DX-017': {
            assert.ok(world.storage);
            const response = metricResponse('PhysicalPartitionSizeInfo', []);
            response.value[0].timeseries = world.storage.partitions.map((partition) => ({
                metadatavalues: [{ name: { value: 'PhysicalPartitionId' }, value: partition.partitionId }],
                data: partition.samples.map((sample) => ({
                    timeStamp: new Date(sample.timestamp),
                    maximum: sample.bytes,
                })),
            }));
            const observation =
                detector === 'DX-015'
                    ? DIAGNOSTIC_POLICY.storageSkew.observation
                    : DIAGNOSTIC_POLICY.storageGrowth.observation;
            const summary = await withMetrics(response, (client) =>
                getPartitionStorageSeries(
                    client,
                    'fixture-account',
                    observation.timeRange,
                    scope.databaseId,
                    scope.containerId,
                    observation,
                ),
            );
            const input = { ...scope, partitions: summary.partitions, resourceAgeDays: world.age };
            if (detector === 'DX-015') {
                world.inputs.storageSkew = [input];
                world.result = storageSkewRiskDetector.evaluateResult(input, thresholds.storageSkewBalanceRatio);
            } else {
                world.inputs.storage = [input];
                world.result = storageGrowthRiskDetector.evaluateResult(input, thresholds.storageGrowthHorizonDays);
            }
            break;
        }
        case 'DX-016':
            world.inputs.accountConfig = world.account;
            world.result = expensiveConsistencyDetector.evaluateResult(world.account);
            break;
        case 'DX-018': {
            assert.ok(world.requests);
            const response = metricResponse(
                'TotalRequests',
                [[world.requests.total - world.requests.throttled], [world.requests.throttled]],
                'count',
            );
            for (const [index, series] of (response.value[0].timeseries ?? []).entries()) {
                series.metadatavalues = [{ name: { value: 'StatusCode' }, value: index === 0 ? '200' : '429' }];
            }
            const summary = await withMetrics(response, (client) =>
                getThrottleRate(
                    client,
                    'fixture-account',
                    DIAGNOSTIC_POLICY.serverlessThrottling.observation.timeRange,
                    scope.databaseId,
                    scope.containerId,
                    DIAGNOSTIC_POLICY.serverlessThrottling.observation,
                ),
            );
            const input = { ...scope, totalRequests: summary.totalRequests, throttleRatePercent: summary.ratePercent };
            world.inputs.serverlessThrottling = [input];
            world.result = serverlessThrottlingDetector.evaluateResult(input);
            break;
        }
        case 'DX-019':
            world.inputs.accountConfig = world.account;
            world.result = paidContinuousBackupDetector.evaluateResult(world.account);
            break;
        case 'DX-021': {
            assert.ok(world.statuses);
            const input = { statusCounts: world.statuses, throttledOperationCounts: world.operations };
            world.inputs.accountRequests = input;
            world.result = throttlingByOperationDetector.evaluateResult(input);
            break;
        }
        case 'DX-022':
            world.inputs.accountConfig = world.account;
            world.result = perRegionAutoscaleCandidateDetector.evaluateResult(world.account);
            break;
        case 'DX-023':
            world.inputs.accountConfig = world.account;
            world.result = reservedCapacityCandidateDetector.evaluateResult(
                world.inputs.scopeProvisionedRuTotal,
                world.account.isServerless,
            );
            break;
        case 'DX-024': {
            assert.ok(world.indexing);
            const summary = await withMetrics(
                (options) => {
                    const name = options?.metricnames;
                    assert.ok(name === 'IndexUsage' || name === 'DataUsage');
                    return metricResponse(name, [
                        name === 'IndexUsage' ? (world.indexSeries ?? []) : (world.dataSeries ?? []),
                    ]);
                },
                (client) => getContainerIndexingUsage(client, 'fixture-account', scope.databaseId, scope.containerId),
            );
            const input = { ...world.indexing, ...summary };
            world.inputs.indexing = [input];
            world.result = indexingCostRiskDetector.evaluateResult(input, thresholds.indexingUsageRatio);
            break;
        }
        default:
            throw new Error(`No native binding for ${detector}.`);
    }
}

function outcome(pattern: RegExp, execute: Binding['execute']): Binding {
    return { type: 'Outcome', pattern, execute };
}

export const additionalOutcomes: readonly Binding[] = [
    outcome(/^the recoverable capacity is (\S+) RU\/s$/, (world, match) => {
        const value = observed(world, 'recoverableRu');
        assert.equal(typeof value, 'number');
        near(typeof value === 'number' ? value : undefined, match[1]);
    }),
    outcome(/^DX-004 applies to it$/, (world) => {
        assert.ok(world.applicabilityMode);
        assert.equal(idleContainerDetector.appliesTo(world.applicabilityMode), true);
        world.applicabilityChecked = true;
    }),
    outcome(/^DX-004 is not in it$/, (world) => {
        assert.equal(world.applicabilityMode, 'serverless');
        assert.equal(idleContainerDetector.appliesTo(world.applicabilityMode), false);
        world.applicabilityChecked = true;
    }),
    outcome(/^the container is (not )?reported as under-provisioned$/, (world, match) => {
        observation(world);
        assert.equal(world.advisory !== undefined, !match[1]);
    }),
    outcome(/^the recommendation mentions the autoscale max$/, (world) => {
        observation(world);
        assert.ok(world.advisory?.suggestedAction.includes('autoscale max'));
    }),
    outcome(/^the recommendation says to convert to autoscale$/, (world) => {
        observation(world);
        assert.ok(world.advisory?.suggestedAction.includes('Convert to autoscale'));
    }),
    outcome(/^the recommendation mentions a max of (\d+) RU\/s$/, (world, match) => {
        observation(world);
        assert.ok(world.advisory?.suggestedAction.includes(`max ≈ ${number(match[1])} RU/s`));
    }),
    outcome(/^the (monopolizer|victim) is "([^"]+)"$/, (world, match) => {
        assert.equal(observed(world, match[1]), match[2]);
    }),
    outcome(/^the regional capacity evidence is (quantified|unavailable)$/, (world, match) => {
        assert.equal(observed(world, 'regionalCapacityQuantified'), match[1] === 'quantified');
    }),
    outcome(
        /^the (configured per-region throughput|global regional footprint|removable extra region throughput) is (\S+) RU\/s$/,
        (world, match) => {
            const key =
                match[1] === 'configured per-region throughput'
                    ? 'configuredPerRegionRu'
                    : match[1] === 'global regional footprint'
                      ? 'globalRegionalFootprintRu'
                      : 'removableExtraRegionRu';
            const value = observed(world, key);
            assert.equal(typeof value, 'number');
            near(typeof value === 'number' ? value : undefined, match[2]);
        },
    ),
    outcome(/^no extra region throughput is removable$/, (world) => {
        assert.equal(observed(world, 'removableExtraRegionRu'), null);
    }),
    outcome(/^merge eligibility is (\S+)$/, (world, match) => {
        assert.equal(observed(world, 'mergeEligibility'), match[1]);
    }),
    outcome(/^the merge guidance contains "([^"]+)"$/, (world, match) => {
        observation(world);
        assert.ok(world.advisory?.suggestedAction.includes(match[1]), `Missing merge guidance: ${match[1]}`);
    }),
    outcome(/^no instruction to merge partitions is emitted$/, (world) => {
        observation(world);
        assert.ok(world.advisory);
        assert.ok(!world.advisory.suggestedAction.includes('consider merging'));
        assert.ok(!world.advisory.suggestedAction.includes('Merge the partitions'));
    }),
    outcome(/^Session guidance uses the end-user token round trip$/, (world) => {
        observation(world);
        assert.ok(world.advisory);
        for (const required of [
            'one default consistency level',
            'Cosmos response SessionToken',
            'end-user client in a cookie',
            'later web request',
            'Cosmos request options of whichever SDK instance',
            'no direct SDK-to-SDK synchronization',
            'opaque, partition-bound',
            'not equivalent to Strong',
        ]) {
            assert.ok(world.advisory.suggestedAction.includes(required), `Missing Session guidance: ${required}`);
        }
    }),
    outcome(
        /^the (?:days to the limit is|throttle rate is|index to data ratio is|user excluded path count is) (\S+)(?: percent)?$/,
        (world, match) => {
            const key = match[0].startsWith('the days')
                ? 'daysToLimit'
                : match[0].startsWith('the throttle')
                  ? 'throttleRatePercent'
                  : match[0].startsWith('the index')
                    ? 'indexDataRatio'
                    : 'userExcludedPathCount';
            const value = observed(world, key);
            assert.equal(typeof value, 'number');
            near(typeof value === 'number' ? value : undefined, match[1]);
        },
    ),
    outcome(/^the dominant (operation|category) is (\S+)$/, (world, match) => {
        assert.equal(observed(world, match[1] === 'operation' ? 'dominantOperation' : 'dominantCategory'), match[2]);
    }),
];

export const ACTION_DETECTORS: Readonly<Record<string, string>> = {
    'classifies the shared pool': 'DX-003',
    'detects shared-throughput starvation': 'DX-003',
    'classifies the ingestion pattern': 'DX-010',
    'detects uncontrolled ingestion': 'DX-010',
    'reads the partition sizes for DX-017': 'DX-017',
    'reads the metrics for DX-018': 'DX-018',
};
