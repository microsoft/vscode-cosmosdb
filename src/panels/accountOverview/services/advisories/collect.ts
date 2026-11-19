/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient } from '@azure/arm-monitor';
import {
    getSqlInventoryDetails,
    type InventoryContainerRow,
    type InventoryThroughputOffer,
    type ThroughputMode,
} from '../inventory';
import {
    getPartitionHealth,
    getPartitionStorageSeries,
    DEFAULT_PARTITION_THRESHOLDS,
    type PartitionStorageResult,
} from '../partitionHealth';
import { captureReadDiagnostics, readRequest } from '../readDiagnostics';
import { getContainerCreatedAt, getKnownResourceAgeDays, getSystemCreatedAt } from '../resourceAge';
import { getRuTrends, getThrottleRate } from '../ruTrends';
import { classifyUnavailable, containerKey } from '../shared';
import { configurationFailures, offerScope } from './core/helpers';
import { summarizeRequestStatuses } from './core/requestMetrics';
import { DIAGNOSTIC_POLICY } from './core/thresholds';
import {
    type AccountConfigInput,
    type ContainerStorageInput,
    type AccountRequestMetricsInput,
    type CrossPartitionInput,
    type ConsistencyReadRuInput,
    type CostSourceStatus,
    type DerivedAdvisory,
    type DerivedAdvisoryRule,
    type DerivedAdvisoryThresholds,
    type DetectorCoverage,
    type IdleContainerInput,
    type IndexingUsageInput,
    type LogsSourceStatus,
    type MetricSourceStatus,
    type PartitionMergeInput,
    type PartitionSaturationInput,
    type ServerlessCandidateInput,
    type ServerlessThrottlingInput,
    type SharedThroughputInput,
    type UncontrolledIngestionInput,
} from './core/types';
import { enrichAdvisoryCosts } from './costEstimates';
import { completeDetectorCoverage } from './coverage';
import { expensiveConsistencyDetector } from './detectors/ExpensiveConsistencyDetector';
import { hasSingleObservedStoragePartition, hasSingleStoragePartition } from './detectors/storageMath';
import { analyzeDerivedAdvisories } from './engine';
import { type CostContext } from './fetchers/costManagement';
import {
    fetchConsistencyReadRu,
    fetchCrossPartitionShapes,
    fetchSharedThroughputTraffic,
    fetchUncontrolledIngestion,
    logWindow,
    probeCdbLogs,
    requestLogEvidence,
    requestLogWindow,
    selectDataPlaneSource,
    type LogsQueryExecutor,
} from './fetchers/logs';
import { type LogsDiagnostic, type LogsDiagnosticReporter } from './fetchers/logsDiagnostics';
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

// ─── Server-side orchestration ──────────────────────────────────────────────────

const METRIC_BATCH_SIZE = 5;
const AGE_GATED_RULES: readonly DerivedAdvisoryRule[] = [
    'OverProvisioning',
    'AutoscaleCandidate',
    'IdleContainer',
    'SustainedThrottlingInRegion',
    'HotPartitionRisk',
    'AutoscaleMaxOverProvisioned',
    'AutoscaleToManualCandidate',
    'StorageSkewRisk',
];

const INVENTORY_DEPENDENT_RULES: readonly DerivedAdvisoryRule[] = [
    'OverProvisioning',
    'AutoscaleCandidate',
    'IdleContainer',
    'SustainedThrottlingInRegion',
    'HotPartitionRisk',
    'PartitionMergeCandidate',
    'AutoscaleMaxOverProvisioned',
    'AutoscaleToManualCandidate',
    'StorageGrowthRisk',
    'StorageSkewRisk',
    'IndexingCostRisk',
    'ServerlessThrottling',
    'CrossPartitionQuery',
    'ShardKeyMisalignment',
    'UncontrolledIngestion',
    'SharedThroughputStarvation',
] as const;

interface CollectResult<T> {
    value?: T;
    reason?: MetricSourceStatus['failures'][number]['reason'];
    failures: readonly MetricSourceStatus['failures'][number]['reason'][];
}

/** Everything {@link collectDerivedAdvisories} needs, gathered by the router as data preparation. */
export interface CollectDerivedAdvisoriesParams {
    monitorClient: MonitorClient;
    cosmosClient: CosmosDBManagementClient;
    accountId: string;
    resourceGroup: string;
    accountName: string;
    isServerless: boolean;
    advisoryThresholds: DerivedAdvisoryThresholds;
    /** Account-level ARM configuration for the config-only advisories (DX-016 / DX-008). */
    accountConfig?: AccountConfigInput;
    /**
     * Data-plane Log Analytics client for the Tier-2 log-based advisories (DX-002/003/007/010). Absent when the
     * client could not be acquired — the collector then reports Tier-2 as unavailable while still returning
     * Tier-1 advisories. A known acquisition cause takes precedence over the generic `noData` fallback.
     */
    logsClient?: LogsQueryExecutor;
    /** Known acquisition cause; preserves sign-in/access guidance without forwarding SDK errors. */
    logsClientFailure?: Pick<LogsDiagnostic, 'kind' | 'reason'>;
    /** Sanitized Log Analytics failures for the local Output channel, not telemetry. */
    onLogsDiagnostic?: LogsDiagnosticReporter;
    /** Existing ARM cloud/subscription context for optional read-only financial enrichment. */
    costContext?: CostContext;
}

/** What {@link collectDerivedAdvisories} returns: the fired advisories plus the Tier-2 (Log Analytics) coverage status. */
export interface CollectedDerivedAdvisories {
    advisories: DerivedAdvisory[];
    logSource: LogsSourceStatus;
    metricSource: MetricSourceStatus;
    costSource?: CostSourceStatus;
    detectorCoverage: DetectorCoverage[];
}

/** The Tier-2 inputs gathered from Log Analytics plus the coverage status the card surfaces. */
interface Tier2Logs {
    crossPartition: CrossPartitionInput[];
    ingestion: UncontrolledIngestionInput[];
    sharedThroughput: SharedThroughputInput[];
    consistencyReadRu?: ConsistencyReadRuInput;
    logSource: LogsSourceStatus;
}

function addMetricFailure(
    failures: MetricSourceStatus['failures'],
    rule: DerivedAdvisoryRule,
    reason: MetricSourceStatus['failures'][number]['reason'],
    scope?: string,
): void {
    if (!failures.some((failure) => failure.rule === rule && failure.scope === scope && failure.reason === reason)) {
        failures.push({ rule, scope, reason });
    }
}

async function mapInBatches<TItem, TResult>(
    items: readonly TItem[],
    worker: (item: TItem, index: number) => Promise<TResult>,
    batchSize = METRIC_BATCH_SIZE,
): Promise<TResult[]> {
    const results: TResult[] = [];
    for (let start = 0; start < items.length; start += batchSize) {
        const batch = items.slice(start, start + batchSize);
        results.push(...(await Promise.all(batch.map((item, index) => worker(item, start + index)))));
    }
    return results;
}

async function capture<T>(work: () => Promise<T>): Promise<CollectResult<T>> {
    const captured = await captureReadDiagnostics(async () => {
        try {
            return { value: await work() };
        } catch (error) {
            return { reason: classifyUnavailable(error) };
        }
    });

    return { ...captured.result, failures: captured.diagnostics.map(({ reason }) => reason) };
}

function isDedicatedContainerOffer(row: InventoryContainerRow): boolean {
    return row.offerLevel === 'container' && row.throughputRU !== undefined && row.throughputRU > 0;
}

function isServerlessContainer(row: InventoryContainerRow): boolean {
    return row.throughputMode === 'serverless';
}

function scopeOf(row: { databaseId: string; containerId?: string }): string {
    return offerScope(row);
}

function rowAgeDays(row: InventoryContainerRow, accountCreatedAt: string | undefined, now: number): number | undefined {
    return getKnownResourceAgeDays(row.resourceCreatedAt ?? row.offerCreatedAt, accountCreatedAt, now);
}

function lookupRowAgeDays(
    rowsByScope: ReadonlyMap<string, InventoryContainerRow>,
    databaseId: string,
    containerId: string,
    accountCreatedAt: string | undefined,
    now: number,
): number | undefined {
    const row = rowsByScope.get(containerKey(databaseId, containerId));
    return row ? rowAgeDays(row, accountCreatedAt, now) : undefined;
}

async function getAccountCreatedAt(
    cosmosClient: CosmosDBManagementClient,
    resourceGroup: string,
    accountName: string,
): Promise<string | undefined> {
    return getSystemCreatedAt(
        await readRequest('account', 'databaseAccounts.get', () =>
            cosmosClient.databaseAccounts.get(resourceGroup, accountName),
        ),
    );
}

/**
 * Gathers the telemetry the derived-advisory rules need — authoritative offer inventory, per-offer/manual RU history,
 * per-container partition/storage signals, account-level serverless shape, and Tier-2 Log Analytics evidence — then
 * runs {@link analyzeDerivedAdvisories}. Failures degrade to per-rule coverage rather than blanking config-only checks.
 */
export async function collectDerivedAdvisories(
    params: CollectDerivedAdvisoriesParams,
): Promise<CollectedDerivedAdvisories> {
    const {
        monitorClient,
        cosmosClient,
        accountId,
        resourceGroup,
        accountName,
        isServerless,
        advisoryThresholds,
        accountConfig,
        logsClient,
    } = params;

    const now = Date.now();
    const effectiveAccountConfig = accountConfig && { ...accountConfig, isServerless };
    const metricFailures = configurationFailures(effectiveAccountConfig);
    const ageFailures: MetricSourceStatus['failures'] = [];
    const metricCoverageFailures: MetricSourceStatus['failures'] = [];
    const accountCreatedAtPromise = capture(() => getAccountCreatedAt(cosmosClient, resourceGroup, accountName));
    const accountRequestsPromise = capture(() => getAccountRequestStatusCounts(monitorClient, accountId, now));

    function recordMetricFailure(
        rule: DerivedAdvisoryRule,
        read: CollectResult<unknown>,
        scope?: string,
        reason = read.reason ?? 'noData',
        required = true,
    ): void {
        addMetricFailure(metricFailures, rule, reason, scope);
        if (required) {
            const reasons = [...read.failures, ...(read.reason ? [read.reason] : [])];
            if (reason !== 'noData') {
                reasons.push(reason);
            }
            for (const failure of reasons) {
                addMetricFailure(metricCoverageFailures, rule, failure, scope);
            }
        }
    }

    let rows: InventoryContainerRow[] = [];
    let offers: InventoryThroughputOffer[] = [];
    const inventory = await capture(() =>
        getSqlInventoryDetails(cosmosClient, resourceGroup, accountName, isServerless),
    );
    if (inventory.value) {
        rows = inventory.value.rows;
        offers = inventory.value.offers;
    } else if (inventory.reason) {
        for (const rule of INVENTORY_DEPENDENT_RULES) {
            recordMetricFailure(rule, inventory);
        }
    }

    const accountCreation = await accountCreatedAtPromise;
    const accountCreatedAt = accountCreation.value;
    const dedicatedTargets = rows.filter(isDedicatedContainerOffer);
    if (accountCreation.reason && offers.length > 0) {
        for (const rule of AGE_GATED_RULES) {
            addMetricFailure(ageFailures, rule, accountCreation.reason);
        }
    }
    await mapInBatches(
        dedicatedTargets.filter((row) => !row.resourceCreatedAt),
        async (row) => {
            const creation = await capture(() =>
                getContainerCreatedAt(monitorClient, accountId, row.databaseId, row.containerId, now),
            );
            if (creation.reason) {
                for (const rule of AGE_GATED_RULES) {
                    addMetricFailure(ageFailures, rule, creation.reason, scopeOf(row));
                }
            } else if (creation.value) {
                row.resourceCreatedAt = creation.value;
            }
        },
    );
    const uniqueOffers = new Map<string, InventoryThroughputOffer>();
    const invalidOfferScopes = new Set<string>();
    for (const offer of offers) {
        const scope = scopeOf(offer);
        if (
            !Number.isFinite(offer.throughputRU) ||
            offer.throughputRU <= 0 ||
            uniqueOffers.has(scope) ||
            invalidOfferScopes.has(scope)
        ) {
            uniqueOffers.delete(scope);
            invalidOfferScopes.add(scope);
            for (const rule of AGE_GATED_RULES) {
                addMetricFailure(metricFailures, rule, 'noData', scope);
            }
            continue;
        }
        uniqueOffers.set(scope, offer);
    }
    const offerTargets = [...uniqueOffers.values()];
    const manualTargets = offerTargets.filter((offer) => offer.offerThroughputMode === 'manual');
    const autoscaleTargets = offerTargets.filter((offer) => offer.offerThroughputMode === 'autoscale');
    const serverlessTargets = rows.filter(isServerlessContainer);
    const logTargets = rows.filter((row) => isDedicatedContainerOffer(row) || isServerlessContainer(row));
    const rowsByScope = new Map(rows.map((row) => [scopeOf(row), row]));
    const sharedContainerIds = (offer: InventoryThroughputOffer): string[] | undefined =>
        offer.offerLevel === 'database'
            ? rows
                  .filter((row) => row.databaseId === offer.databaseId && row.offerLevel === 'database')
                  .map((row) => row.containerId)
            : undefined;
    const offerAgeDays = (offer: InventoryThroughputOffer): number | undefined =>
        getKnownResourceAgeDays(
            rowsByScope.get(scopeOf(offer))?.resourceCreatedAt ?? offer.resourceCreatedAt,
            accountCreatedAt,
            now,
        );
    const scopeProvisionedRuTotal =
        inventory.value?.throughputInventoryComplete !== true || invalidOfferScopes.size > 0
            ? undefined
            : offerTargets.reduce((sum, offer) => sum + offer.throughputRU, 0);
    if (!isServerless && scopeProvisionedRuTotal === undefined) {
        recordMetricFailure('ReservedCapacityCandidate', inventory, undefined, inventory.reason ?? 'noData');
    }

    const statusResult = await accountRequestsPromise;
    const statuses = statusResult.value && summarizeRequestStatuses(statusResult.value);
    let accountRequests: AccountRequestMetricsInput | undefined;
    if (!statusResult.value || !statuses || !Number.isFinite(statuses.totalRequests) || statuses.totalRequests === 0) {
        for (const rule of ['NonThrottlingErrors', 'ThrottlingByOperation'] as const) {
            recordMetricFailure(rule, statusResult);
        }
    } else {
        accountRequests = { statusCounts: statusResult.value };
        if (
            statuses.totalRequests >= DIAGNOSTIC_POLICY.accountRequests.minRequests &&
            (100 * statuses.totalThrottled) / statuses.totalRequests >=
                DIAGNOSTIC_POLICY.throttlingByOperation.ratePercent
        ) {
            const operations = await capture(() => getThrottledOperationCounts(monitorClient, accountId, now));
            if (!operations.value || Object.keys(operations.value).length === 0) {
                recordMetricFailure('ThrottlingByOperation', operations);
            } else {
                accountRequests.throttledOperationCounts = operations.value;
            }
        }
    }

    const manualObservation = DIAGNOSTIC_POLICY.overProvisioning.observation;
    const saturationObservation = DIAGNOSTIC_POLICY.partitionSaturation.observation;
    const storageObservation = DIAGNOSTIC_POLICY.storageGrowth.observation;
    const storageSkewObservation = DIAGNOSTIC_POLICY.storageSkew.observation;
    const serverlessThrottleObservation = DIAGNOSTIC_POLICY.serverlessThrottling.observation;

    const manualThroughput = (
        await mapInBatches(manualTargets, async (row) => {
            const captured = await captureReadDiagnostics(
                () =>
                    getRuTrends(
                        monitorClient,
                        accountId,
                        manualObservation.timeRange,
                        row.databaseId,
                        row.containerId,
                        manualObservation,
                        sharedContainerIds(row),
                    ),
                ['NormalizedRUConsumption'],
            );
            return { row, result: captured.result, failures: captured.diagnostics.map(({ reason }) => reason) };
        })
    ).flatMap(({ row, result, failures }) => {
        const scope = scopeOf(row);
        if (!result.available) {
            const reason = result.reason ?? 'noData';
            recordMetricFailure('OverProvisioning', { failures }, scope, reason);
            recordMetricFailure('AutoscaleCandidate', { failures }, scope, reason);
            return [];
        }
        const ruPercents = result.points
            .map((point) => point.ruPercent)
            .filter((value): value is number => value !== undefined);
        return row.throughputRU === undefined
            ? []
            : [
                  {
                      databaseId: row.databaseId,
                      containerId: row.containerId,
                      ruPercents,
                      peakPercent: result.peakPercent,
                      provisionedRu: row.throughputRU,
                      resourceAgeDays: offerAgeDays(row),
                  },
              ];
    });

    const idleContainers: IdleContainerInput[] = (
        await mapInBatches(offerTargets, async (row) => ({
            row,
            result: await capture(() =>
                getContainerIdlePeak(
                    monitorClient,
                    accountId,
                    row.databaseId,
                    row.containerId,
                    now,
                    sharedContainerIds(row),
                ),
            ),
        }))
    ).flatMap(({ row, result }) => {
        if (result.value === undefined) {
            recordMetricFailure('IdleContainer', result, scopeOf(row));
            return [];
        }
        return [
            {
                databaseId: row.databaseId,
                containerId: row.containerId,
                peakRuPerBucket: result.value,
                throughputMode: row.throughputMode,
                provisionedRu: row.throughputRU,
                resourceAgeDays: offerAgeDays(row),
            },
        ];
    });

    const indexing: IndexingUsageInput[] = (
        await mapInBatches(
            rows.filter((row) => row.indexingMode.toLowerCase() !== 'none'),
            async (row) => ({
                row,
                result: await capture(() =>
                    getContainerIndexingUsage(monitorClient, accountId, row.databaseId, row.containerId, now),
                ),
            }),
        )
    ).flatMap(({ row, result }) => {
        if (
            !result.value ||
            result.value.indexUsageBytes === undefined ||
            !Number.isFinite(result.value.indexUsageBytes) ||
            result.value.indexUsageBytes < 0 ||
            result.value.dataUsageBytes === undefined ||
            !Number.isFinite(result.value.dataUsageBytes) ||
            result.value.dataUsageBytes <= 0
        ) {
            recordMetricFailure('IndexingCostRisk', result, scopeOf(row));
            return [];
        }
        return [
            {
                databaseId: row.databaseId,
                containerId: row.containerId,
                ...result.value,
                userExcludedPathCount: row.userExcludedPathCount,
                indexingMode: row.indexingMode,
            },
        ];
    });

    const partitionCounts = await mapInBatches(dedicatedTargets, async (row) => ({
        row,
        count: await capture(() =>
            getContainerPartitionCount(monitorClient, accountId, row.databaseId, row.containerId, now),
        ),
    }));
    const countsByScope = new Map(partitionCounts.map(({ row, count }) => [scopeOf(row), count]));
    const partitionSignals = await mapInBatches(offerTargets, async (row) => {
        const { containerId } = row;
        const [partition, throttle, growth, skew] = await Promise.all([
            capture(() =>
                getPartitionHealth(
                    monitorClient,
                    accountId,
                    'ru',
                    saturationObservation.timeRange,
                    row.databaseId,
                    row.containerId,
                    {
                        ...DEFAULT_PARTITION_THRESHOLDS,
                        saturationPercent: advisoryThresholds.partitionSaturationPercent,
                        headroomPercent: advisoryThresholds.partitionHeadroomPercent,
                        skewBalanceRatio: advisoryThresholds.storageSkewBalanceRatio,
                    },
                    saturationObservation,
                    DIAGNOSTIC_POLICY.partitionSaturation.percentile,
                ),
            ),
            capture(() =>
                getThrottleRate(
                    monitorClient,
                    accountId,
                    saturationObservation.timeRange,
                    row.databaseId,
                    row.containerId,
                    saturationObservation,
                    sharedContainerIds(row),
                ),
            ),
            containerId === undefined
                ? undefined
                : capture(() =>
                      getPartitionStorageSeries(
                          monitorClient,
                          accountId,
                          storageObservation.timeRange,
                          row.databaseId,
                          containerId,
                          storageObservation,
                      ),
                  ),
            containerId === undefined
                ? undefined
                : capture(() =>
                      getPartitionStorageSeries(
                          monitorClient,
                          accountId,
                          storageSkewObservation.timeRange,
                          row.databaseId,
                          containerId,
                          storageSkewObservation,
                      ),
                  ),
        ]);
        return { row, partition, throttle, growth, skew };
    });

    const partitions: PartitionSaturationInput[] = [];
    const storage: PartitionStorageResult[] = [];
    const storageSkew: ContainerStorageInput[] = [];
    for (const { row, partition, throttle, growth, skew } of partitionSignals) {
        const scope = scopeOf(row);
        const ageDays = offerAgeDays(row);
        const requiredPartitionRead = { ...partition, failures: [...partition.failures, ...throttle.failures] };
        const count = countsByScope.get(scope);
        const physicalPartitionCount = count?.value;
        const singlePartition =
            physicalPartitionCount === 1 && partition.value?.available === true && partition.value.partitionCount === 1;

        if (count && count.value === undefined && (count.reason || count.failures.length > 0)) {
            if (partition.value?.available && partition.value.partitionCount === 1) {
                recordMetricFailure('HotPartitionRisk', count, scope);
            }
            if (skew?.value?.available && hasSingleObservedStoragePartition(skew.value)) {
                recordMetricFailure('StorageSkewRisk', count, scope);
            }
        }

        if (partition.reason) {
            recordMetricFailure('SustainedThrottlingInRegion', requiredPartitionRead, scope);
            recordMetricFailure('HotPartitionRisk', requiredPartitionRead, scope);
        } else if (!partition.value?.available) {
            const reason = partition.value?.reason === 'error' ? 'noData' : (partition.value?.reason ?? 'noData');
            recordMetricFailure('SustainedThrottlingInRegion', requiredPartitionRead, scope, reason);
            recordMetricFailure('HotPartitionRisk', requiredPartitionRead, scope, reason);
        } else if (throttle.reason) {
            recordMetricFailure('SustainedThrottlingInRegion', throttle, scope);
            recordMetricFailure('HotPartitionRisk', throttle, scope, throttle.reason, !singlePartition);
        }
        if (partition.value?.available && (throttle.value || singlePartition)) {
            partitions.push({
                databaseId: row.databaseId,
                containerId: row.containerId,
                maxP99: partition.value.maxSaturationPercent ?? partition.value.topPartitionShare,
                minP99: partition.value.minSaturationPercent ?? 0,
                partitionCount: partition.value.partitionCount,
                physicalPartitionCount,
                throttleRatePercent: throttle.value?.ratePercent,
                totalRequests: throttle.value?.totalRequests,
                throughputMode: row.throughputMode,
                provisionedRu: row.throughputRU,
                resourceAgeDays: ageDays,
            });
        }

        if (row.containerId === undefined || !growth || !skew) {
            continue;
        }
        if (growth.reason) {
            recordMetricFailure('StorageGrowthRisk', growth, scope);
        } else if (!growth.value?.available) {
            recordMetricFailure('StorageGrowthRisk', growth, scope, growth.value?.reason ?? 'noData');
        } else {
            storage.push(growth.value);
        }

        if (skew.reason) {
            recordMetricFailure('StorageSkewRisk', skew, scope);
        } else if (!skew.value?.available) {
            recordMetricFailure('StorageSkewRisk', skew, scope, skew.value?.reason ?? 'noData');
        } else {
            storageSkew.push({ ...skew.value, physicalPartitionCount });
        }
    }

    const partitionMerges: PartitionMergeInput[] = (
        await mapInBatches(partitionCounts, async ({ row, count }) => ({
            row,
            count,
            storage: await capture(() =>
                getContainerMergeStoragePeak(monitorClient, accountId, row.databaseId, row.containerId, now),
            ),
        }))
    ).flatMap(({ row, count, storage }) => {
        const scope = scopeOf(row);
        if (count.value === undefined) {
            recordMetricFailure('PartitionMergeCandidate', count, scope);
        }
        if (storage.value === undefined) {
            recordMetricFailure(
                'PartitionMergeCandidate',
                storage,
                scope,
                storage.reason ?? 'noData',
                count.value !== 1,
            );
        }
        if (count.value === undefined || (storage.value === undefined && count.value !== 1)) {
            return [];
        }
        return [
            {
                databaseId: row.databaseId,
                containerId: row.containerId,
                actualPartitions: count.value,
                provisionedRu: row.throughputRU,
                dataUsageBytes: storage.value,
                backupPolicy: accountConfig?.backupPolicy,
            },
        ];
    });

    const autoscaleUtilizations = (
        await mapInBatches(autoscaleTargets, async (row) => ({
            row,
            result: await capture(() =>
                getAutoscaleUtilization(monitorClient, accountId, row.databaseId, row.containerId, row.throughputRU),
            ),
        }))
    ).flatMap(({ row, result }) => {
        const scope = scopeOf(row);
        if (result.reason) {
            recordMetricFailure('AutoscaleMaxOverProvisioned', result, scope);
            recordMetricFailure('AutoscaleToManualCandidate', result, scope);
            return [];
        }
        if (!result.value || result.value.sampleCount < DIAGNOSTIC_POLICY.autoscaleUtilization.minSamples) {
            addMetricFailure(metricFailures, 'AutoscaleMaxOverProvisioned', 'noData', scope);
            addMetricFailure(metricFailures, 'AutoscaleToManualCandidate', 'noData', scope);
            return [];
        }
        return [
            {
                databaseId: row.databaseId,
                containerId: row.containerId,
                peakPercent: result.value.peakPercent,
                avgPercent: result.value.avgPercent,
                sampleCount: result.value.sampleCount,
                configuredMaxRu: row.throughputRU,
                resourceAgeDays: offerAgeDays(row),
            },
        ];
    });

    const serverlessThrottling = (
        await mapInBatches(serverlessTargets, async (row) => ({
            row,
            result: await capture(() =>
                getThrottleRate(
                    monitorClient,
                    accountId,
                    serverlessThrottleObservation.timeRange,
                    row.databaseId,
                    row.containerId,
                    serverlessThrottleObservation,
                ),
            ),
        }))
    ).flatMap(({ row, result }) => {
        const scope = scopeOf(row);
        if (result.reason) {
            recordMetricFailure('ServerlessThrottling', result, scope);
            return [];
        }
        return result.value
            ? [
                  {
                      databaseId: row.databaseId,
                      containerId: row.containerId,
                      totalRequests: result.value.totalRequests,
                      throttleRatePercent: result.value.ratePercent,
                  } satisfies ServerlessThrottlingInput,
              ]
            : [];
    });

    const serverlessShape = isServerless
        ? undefined
        : await capture(() => getAccountConsumedRuShape(monitorClient, accountId));
    if (serverlessShape?.reason) {
        recordMetricFailure('ServerlessCandidate', serverlessShape);
    }
    const serverless: ServerlessCandidateInput | undefined = serverlessShape?.value
        ? { ...serverlessShape.value, isServerless }
        : undefined;

    const logs = await collectTier2Logs(
        logsClient,
        accountId,
        logTargets,
        offerTargets,
        params.onLogsDiagnostic,
        dedicatedTargets,
        rows.filter((row) => row.offerLevel === 'database'),
        effectiveAccountConfig !== undefined &&
            expensiveConsistencyDetector.evaluate(effectiveAccountConfig) !== undefined,
        params.logsClientFailure,
    );

    const { advisories, detectorCoverage } = analyzeDerivedAdvisories(
        {
            manualThroughput,
            serverlessThrottling,
            storageSkew: storageSkew.map((result) => ({
                databaseId: result.databaseId,
                containerId: result.containerId,
                physicalPartitionCount: result.physicalPartitionCount,
                partitions: result.partitions,
                resourceAgeDays: lookupRowAgeDays(
                    rowsByScope,
                    result.databaseId,
                    result.containerId,
                    accountCreatedAt,
                    now,
                ),
            })),
            // Compatibility fields stay populated for older detectors, but the per-offer manual inputs above are the
            // authoritative parity path for DX-001 / DX-012.
            weeklyRuPercents: [],
            weeklyPeakPercent: undefined,
            hasManualThroughput: manualTargets.length > 0,
            manualProvisionedRuTotal:
                scopeProvisionedRuTotal === undefined
                    ? undefined
                    : manualTargets.reduce<number | undefined>((sum, row) => (sum ?? 0) + row.throughputRU, undefined),
            partitions,
            storage: storage.map((result) => ({
                databaseId: result.databaseId,
                containerId: result.containerId,
                partitions: result.partitions,
                resourceAgeDays: lookupRowAgeDays(
                    rowsByScope,
                    result.databaseId,
                    result.containerId,
                    accountCreatedAt,
                    now,
                ),
            })),
            indexing,
            idleContainers,
            partitionMerges,
            autoscaleUtilizations,
            serverless,
            scopeProvisionedRuTotal,
            manualRegionalCapacityRu:
                scopeProvisionedRuTotal !== undefined &&
                manualTargets.length > 0 &&
                manualTargets.length === offerTargets.length &&
                !isServerless
                    ? scopeProvisionedRuTotal
                    : undefined,
            accountConfig: effectiveAccountConfig,
            consistencyReadRu: logs.consistencyReadRu,
            accountRequests,
            crossPartition: logs.crossPartition,
            ingestion: logs.ingestion,
            sharedThroughput: logs.sharedThroughput,
        },
        advisoryThresholds,
    );

    if (ageFailures.length > 0) {
        const unknownOfferAges = new Set(
            offerTargets.filter((offer) => offerAgeDays(offer) === undefined).map(scopeOf),
        );
        const unknownManualAges = new Set(
            manualTargets.map(scopeOf).filter((scope) => unknownOfferAges.has(scope)),
        );
        const unknownAutoscaleAges = new Set(
            autoscaleTargets.map(scopeOf).filter((scope) => unknownOfferAges.has(scope)),
        );
        const unknownHotPartitionAges = new Set(unknownOfferAges);
        const unknownStorageAges = new Set(
            dedicatedTargets.filter((row) => rowAgeDays(row, accountCreatedAt, now) === undefined).map(scopeOf),
        );

        if (unknownStorageAges.size > 0) {
            for (const input of storageSkew) {
                if (hasSingleStoragePartition(input)) {
                    unknownStorageAges.delete(scopeOf(input));
                }
            }
        }
        if (unknownHotPartitionAges.size > 0) {
            for (const input of partitions) {
                if (input.partitionCount === 1 && input.physicalPartitionCount === 1) {
                    unknownHotPartitionAges.delete(scopeOf(input));
                }
            }
        }

        // Preserve source failures even when the target's timestamp or an account fallback supplies its age.
        for (const failure of ageFailures) {
            const unknownAges =
                failure.rule === 'StorageSkewRisk'
                    ? unknownStorageAges
                    : failure.rule === 'HotPartitionRisk'
                      ? unknownHotPartitionAges
                      : failure.rule === 'OverProvisioning' || failure.rule === 'AutoscaleCandidate'
                        ? unknownManualAges
                        : failure.rule === 'AutoscaleMaxOverProvisioned' || failure.rule === 'AutoscaleToManualCandidate'
                          ? unknownAutoscaleAges
                          : unknownOfferAges;
            const needsAge = failure.scope === undefined ? unknownAges.size > 0 : unknownAges.has(failure.scope);

            if (needsAge) {
                addMetricFailure(metricCoverageFailures, failure.rule, failure.reason, failure.scope);
            }
            addMetricFailure(metricFailures, failure.rule, failure.reason, failure.scope);
        }
    }

    const metricSource = { available: metricFailures.length === 0, failures: metricFailures };
    const inventoryTargetsKnown =
        inventory.value?.throughputInventoryComplete === true && invalidOfferScopes.size === 0;
    const targetCounts: Partial<Record<DerivedAdvisoryRule, number>> = {
        ServerlessCandidate: isServerless ? 0 : 1,
        ...(inventory.value && {
            IndexingCostRisk: rows.filter((row) => row.indexingMode.toLowerCase() !== 'none').length,
        }),
        ...(inventoryTargetsKnown && {
            HotPartitionRisk: offerTargets.length,
            SustainedThrottlingInRegion: offerTargets.length,
            OverProvisioning: manualTargets.length,
            AutoscaleCandidate: manualTargets.length,
            IdleContainer: offerTargets.length,
            StorageGrowthRisk: offerTargets.filter((offer) => offer.containerId !== undefined).length,
            StorageSkewRisk: offerTargets.filter((offer) => offer.containerId !== undefined).length,
            PartitionMergeCandidate: dedicatedTargets.length,
            AutoscaleMaxOverProvisioned: autoscaleTargets.length,
            AutoscaleToManualCandidate: autoscaleTargets.length,
            ServerlessThrottling: serverlessTargets.length,
            CrossPartitionQuery: logTargets.length,
            ShardKeyMisalignment: logTargets.length,
            UncontrolledIngestion: dedicatedTargets.length,
            SharedThroughputStarvation: offerTargets.filter((offer) => offer.offerLevel === 'database').length,
        }),
    };
    const costSource = await enrichAdvisoryCosts({
        advisories,
        cosmosClient,
        monitorClient,
        context: params.costContext,
        accountId,
        inventoryRows: inventory.value?.rows,
        inventoryFailureReason: inventory.reason,
        now,
    });

    return {
        advisories,
        logSource: logs.logSource,
        metricSource,
        detectorCoverage: completeDetectorCoverage(detectorCoverage, {
            metricSource: { available: metricCoverageFailures.length === 0, failures: metricCoverageFailures },
            logSource: logs.logSource,
            targetCounts,
            uncertainTargetRules:
                inventory.value && !inventoryTargetsKnown
                    ? INVENTORY_DEPENDENT_RULES.filter((rule) => rule !== 'IndexingCostRisk')
                    : undefined,
        }),
        ...(costSource && { costSource }),
    };
}

/**
 * Fetches the Tier-2 (Log Analytics) inputs for the dedicated/serverless containers and the database-level shared
 * throughput offers. Each required table is gated independently: missing query-runtime logs must not suppress
 * ingestion or shared-throughput checks. Failed queries are excluded from evaluation and recorded as partial coverage.
 */
export async function collectTier2Logs(
    logsClient: LogsQueryExecutor | undefined,
    accountId: string,
    scanTargets: readonly { databaseId: string; containerId: string }[],
    rows: readonly {
        databaseId: string;
        containerId?: string;
        throughputMode: ThroughputMode;
        throughputRU?: number;
        offerLevel?: 'database' | 'container' | 'none';
    }[],
    onDiagnostic?: LogsDiagnosticReporter,
    ingestionTargets: readonly { databaseId: string; containerId: string }[] = scanTargets,
    sharedMembers: readonly { databaseId: string; containerId: string }[] = [],
    includeConsistencyReadRu = false,
    clientFailure?: Pick<LogsDiagnostic, 'kind' | 'reason'>,
): Promise<Tier2Logs> {
    const empty = { crossPartition: [], ingestion: [], sharedThroughput: [] };
    const failures: NonNullable<LogsSourceStatus['failures']> = [];
    const report: LogsDiagnosticReporter = (diagnostic: LogsDiagnostic) => {
        if (
            !failures.some(
                (failure) =>
                    failure.operation === diagnostic.operation &&
                    failure.kind === diagnostic.kind &&
                    failure.reason === diagnostic.reason,
            )
        ) {
            failures.push({ operation: diagnostic.operation, kind: diagnostic.kind, reason: diagnostic.reason });
        }
        onDiagnostic?.(diagnostic);
    };
    const coverage = (): LogsSourceStatus => {
        if (failures.length === 0) {
            return { available: true };
        }
        const reason = failures.some((failure) => failure.reason === 'rbac')
            ? 'rbac'
            : failures.some((failure) => failure.reason === 'logAnalyticsDisabled')
              ? 'logAnalyticsDisabled'
              : 'noData';
        return { available: false, reason, failures };
    };
    if (!logsClient) {
        if (clientFailure) {
            failures.push({ operation: 'client', ...clientFailure });
            return { ...empty, logSource: coverage() };
        }
        report({
            operation: 'client',
            kind: 'clientUnavailable',
            reason: 'noData',
            codes: [],
            messages: ['The Log Analytics query client could not be acquired.'],
        });
        return { ...empty, logSource: coverage() };
    }

    const now = Date.now();
    const timespan = logWindow(now);
    const [dataPlane, queryRuntime] = await Promise.all([
        selectDataPlaneSource(logsClient, accountId, timespan, report),
        probeCdbLogs(logsClient, accountId, timespan, { onDiagnostic: report, table: 'CDBQueryRuntimeStatistics' }),
    ]);
    const dataPlaneSource = dataPlane?.source;
    const hasRequestData = dataPlane?.hasData === true;
    const hasQueryData = queryRuntime.available && queryRuntime.hasData;
    const dataPlaneTimespan = dataPlaneSource ? requestLogWindow(dataPlaneSource, now) : timespan;
    const emptyReadCharge: ConsistencyReadRuInput | undefined =
        includeConsistencyReadRu && dataPlaneSource && !hasRequestData
            ? {
                  ...requestLogEvidence(dataPlaneSource, dataPlaneTimespan),
                  status: 'noObservations',
                  readRequests: 0,
                  readRu: 0,
              }
            : undefined;

    const sharedDatabases = new Map<string, number>();
    for (const row of rows) {
        const isDatabaseOffer = row.offerLevel === 'database';
        if (isDatabaseOffer && row.throughputRU !== undefined) {
            sharedDatabases.set(row.databaseId, row.throughputRU);
        } else if (!row.offerLevel && row.throughputMode === 'shared' && !sharedDatabases.has(row.databaseId)) {
            sharedDatabases.set(row.databaseId, row.throughputRU ?? 0);
        }
    }

    const [crossPartitionResults, ingestionResults, sharedResults, consistencyReadRu] = await Promise.all([
        mapInBatches(hasQueryData ? scanTargets : [], (row) =>
            fetchCrossPartitionShapes(
                logsClient,
                accountId,
                row.databaseId,
                row.containerId,
                timespan,
                report,
                dataPlaneSource !== 'CDBDataPlaneRequests' || hasRequestData,
            ).catch(() => undefined),
        ),
        mapInBatches(hasRequestData ? ingestionTargets : [], (row) =>
            fetchUncontrolledIngestion(
                logsClient,
                accountId,
                row.databaseId,
                row.containerId,
                dataPlaneTimespan,
                report,
                dataPlaneSource,
            ).catch(() => undefined),
        ),
        mapInBatches(hasRequestData ? [...sharedDatabases] : [], ([databaseId, sharedRu]) =>
            fetchSharedThroughputTraffic(
                logsClient,
                accountId,
                databaseId,
                sharedRu,
                dataPlaneTimespan,
                report,
                dataPlaneSource,
            ).catch(() => undefined),
        ),
        includeConsistencyReadRu && dataPlaneSource && hasRequestData
            ? fetchConsistencyReadRu(logsClient, accountId, dataPlaneTimespan, report, dataPlaneSource).catch(
                  () => undefined,
              )
            : emptyReadCharge,
    ]);

    return {
        crossPartition: crossPartitionResults.filter((result): result is CrossPartitionInput => result !== undefined),
        ingestion: ingestionResults.filter((result): result is UncontrolledIngestionInput => result !== undefined),
        sharedThroughput: sharedResults
            .filter((result): result is SharedThroughputInput => result !== undefined)
            .map((result) => ({
                ...result,
                sharedContainerIds: sharedMembers
                    .filter((member) => member.databaseId === result.databaseId)
                    .map((member) => member.containerId),
            })),
        consistencyReadRu,
        logSource: coverage(),
    };
}
