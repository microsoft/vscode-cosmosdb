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
import { getInventoryMetrics, type HealthThresholds } from '../inventoryMetrics';
import {
    getPartitionHealth,
    getPartitionStorageSeries,
    type PartitionStorageResult,
    type PartitionThresholds,
} from '../partitionHealth';
import { getContainerCreatedAt, getKnownResourceAgeDays, getSystemCreatedAt } from '../resourceAge';
import { getRuTrends, getThrottleRate } from '../ruTrends';
import { classifyUnavailable, containerKey } from '../shared';
import { DIAGNOSTIC_POLICY } from './core/thresholds';
import {
    type AccountConfigInput,
    type CrossPartitionInput,
    type DerivedAdvisory,
    type DerivedAdvisoryRule,
    type DerivedAdvisoryThresholds,
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
import { computeDerivedAdvisories } from './engine';
import {
    fetchCrossPartitionShapes,
    fetchSharedThroughputTraffic,
    fetchUncontrolledIngestion,
    logWindow,
    probeCdbLogs,
    type LogsQueryExecutor,
} from './fetchers/logs';
import { type LogsDiagnostic, type LogsDiagnosticReporter } from './fetchers/logsDiagnostics';
import {
    getAccountConsumedRuShape,
    getAutoscaleUtilization,
    getContainerIdlePeak,
    getContainerMergeStoragePeak,
    getContainerPartitionCount,
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
}

/** Everything {@link collectDerivedAdvisories} needs, gathered by the router as data preparation. */
export interface CollectDerivedAdvisoriesParams {
    monitorClient: MonitorClient;
    cosmosClient: CosmosDBManagementClient;
    accountId: string;
    resourceGroup: string;
    accountName: string;
    isServerless: boolean;
    healthThresholds: HealthThresholds;
    partitionThresholds: PartitionThresholds;
    advisoryThresholds: DerivedAdvisoryThresholds;
    /** Account-level ARM configuration for the config-only advisories (DX-016 / DX-008). */
    accountConfig?: AccountConfigInput;
    /**
     * Data-plane Log Analytics client for the Tier-2 log-based advisories (DX-002/003/007/010). Absent when the
     * client could not be acquired — the collector then reports Tier-2 as unavailable (`noData`) while still
     * returning the Tier-1 advisories.
     */
    logsClient?: LogsQueryExecutor;
    /** Sanitized Log Analytics failures for the local Output channel, not telemetry. */
    onLogsDiagnostic?: LogsDiagnosticReporter;
}

/** What {@link collectDerivedAdvisories} returns: the fired advisories plus the Tier-2 (Log Analytics) coverage status. */
export interface CollectedDerivedAdvisories {
    advisories: DerivedAdvisory[];
    logSource: LogsSourceStatus;
    metricSource: MetricSourceStatus;
}

/** The Tier-2 inputs gathered from Log Analytics plus the coverage status the card surfaces. */
interface Tier2Logs {
    crossPartition: CrossPartitionInput[];
    ingestion: UncontrolledIngestionInput[];
    sharedThroughput: SharedThroughputInput[];
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

async function capture<T>(work: Promise<T>): Promise<CollectResult<T>> {
    try {
        return { value: await work };
    } catch (error) {
        return { reason: classifyUnavailable(error) };
    }
}

function isDedicatedContainerOffer(row: InventoryContainerRow): boolean {
    return row.offerLevel === 'container' && row.throughputRU !== undefined && row.throughputRU > 0;
}

function isDedicatedManualOffer(row: InventoryContainerRow): boolean {
    return isDedicatedContainerOffer(row) && row.offerThroughputMode === 'manual';
}

function isDedicatedAutoscaleOffer(row: InventoryContainerRow): boolean {
    return isDedicatedContainerOffer(row) && row.offerThroughputMode === 'autoscale';
}

function isServerlessContainer(row: InventoryContainerRow): boolean {
    return row.throughputMode === 'serverless';
}

function scopeOf(row: Pick<InventoryContainerRow, 'databaseId' | 'containerId'>): string {
    return containerKey(row.databaseId, row.containerId);
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
    return getSystemCreatedAt(await cosmosClient.databaseAccounts.get(resourceGroup, accountName));
}

/**
 * Gathers the telemetry the derived-advisory rules need — authoritative offer inventory, per-offer/manual RU history,
 * per-container partition/storage signals, account-level serverless shape, and Tier-2 Log Analytics evidence — then
 * runs {@link computeDerivedAdvisories}. Failures degrade to per-rule coverage rather than blanking config-only checks.
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
        healthThresholds,
        partitionThresholds,
        advisoryThresholds,
        accountConfig,
        logsClient,
    } = params;

    const now = Date.now();
    const metricFailures: MetricSourceStatus['failures'] = [];
    const accountCreatedAtPromise = capture(getAccountCreatedAt(cosmosClient, resourceGroup, accountName));

    let rows: InventoryContainerRow[] = [];
    let offers: InventoryThroughputOffer[] = [];
    const inventory = await capture(getSqlInventoryDetails(cosmosClient, resourceGroup, accountName, isServerless));
    if (inventory.value) {
        rows = inventory.value.rows;
        offers = inventory.value.offers;
    } else if (inventory.reason) {
        for (const rule of INVENTORY_DEPENDENT_RULES) {
            addMetricFailure(metricFailures, rule, inventory.reason);
        }
    }

    const accountCreation = await accountCreatedAtPromise;
    const accountCreatedAt = accountCreation.value;
    const dedicatedTargets = rows.filter(isDedicatedContainerOffer);
    if (accountCreation.reason && dedicatedTargets.length > 0) {
        for (const rule of AGE_GATED_RULES) {
            addMetricFailure(metricFailures, rule, accountCreation.reason);
        }
    }
    await mapInBatches(
        dedicatedTargets.filter((row) => !row.resourceCreatedAt),
        async (row) => {
            const creation = await capture(
                getContainerCreatedAt(monitorClient, accountId, row.databaseId, row.containerId, now),
            );
            if (creation.reason) {
                for (const rule of AGE_GATED_RULES) {
                    addMetricFailure(metricFailures, rule, creation.reason, scopeOf(row));
                }
            } else if (creation.value) {
                row.resourceCreatedAt = creation.value;
            }
        },
    );
    const manualTargets = dedicatedTargets.filter(isDedicatedManualOffer);
    const autoscaleTargets = dedicatedTargets.filter(isDedicatedAutoscaleOffer);
    const serverlessTargets = rows.filter(isServerlessContainer);
    const logTargets = rows.filter((row) => isDedicatedContainerOffer(row) || isServerlessContainer(row));
    const rowsByScope = new Map(rows.map((row) => [scopeOf(row), row]));
    const scopeProvisionedRuTotal = offers.reduce<number | undefined>(
        (sum, offer) => (sum ?? 0) + offer.throughputRU,
        undefined,
    );

    const manualObservation = DIAGNOSTIC_POLICY.overProvisioning.observation;
    const saturationObservation = DIAGNOSTIC_POLICY.partitionSaturation.observation;
    const storageObservation = DIAGNOSTIC_POLICY.storageGrowth.observation;
    const storageSkewObservation = DIAGNOSTIC_POLICY.storageSkew.observation;
    const serverlessThrottleObservation = DIAGNOSTIC_POLICY.serverlessThrottling.observation;

    const manualThroughput = (
        await mapInBatches(manualTargets, async (row) => {
            const result = await getRuTrends(
                monitorClient,
                accountId,
                manualObservation.timeRange,
                row.databaseId,
                row.containerId,
                manualObservation,
            );
            return { row, result };
        })
    ).flatMap(({ row, result }) => {
        const scope = scopeOf(row);
        if (!result.available) {
            const reason = result.reason ?? 'noData';
            addMetricFailure(metricFailures, 'OverProvisioning', reason, scope);
            addMetricFailure(metricFailures, 'AutoscaleCandidate', reason, scope);
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
                      resourceAgeDays: rowAgeDays(row, accountCreatedAt, now),
                  },
              ];
    });

    const idleContainers: IdleContainerInput[] = (
        await mapInBatches(dedicatedTargets, async (row) => ({
            row,
            result: await capture(getContainerIdlePeak(monitorClient, accountId, row.databaseId, row.containerId, now)),
        }))
    ).flatMap(({ row, result }) => {
        if (result.value === undefined) {
            addMetricFailure(metricFailures, 'IdleContainer', result.reason ?? 'noData', scopeOf(row));
            return [];
        }
        return [
            {
                databaseId: row.databaseId,
                containerId: row.containerId,
                peakRuPerBucket: result.value,
                throughputMode: row.throughputMode,
                provisionedRu: row.throughputRU,
                resourceAgeDays: rowAgeDays(row, accountCreatedAt, now),
            },
        ];
    });

    const inventoryMetrics =
        rows.length === 0
            ? undefined
            : await getInventoryMetrics(
                  monitorClient,
                  accountId,
                  manualObservation.timeRange,
                  undefined,
                  healthThresholds,
                  manualObservation,
              );
    if (inventoryMetrics && !inventoryMetrics.available) {
        addMetricFailure(metricFailures, 'IndexingCostRisk', inventoryMetrics.reason ?? 'noData');
    }
    const indexing: IndexingUsageInput[] =
        inventoryMetrics?.available === true
            ? rows.map((row) => {
                  const metrics = inventoryMetrics.metrics[scopeOf(row)];
                  return {
                      databaseId: row.databaseId,
                      containerId: row.containerId,
                      indexUsageBytes: metrics?.indexUsageBytes,
                      dataUsageBytes: metrics?.dataUsageBytes,
                      excludedPathCount: row.excludedPathCount,
                  };
              })
            : [];

    const partitionSignals = await mapInBatches(dedicatedTargets, async (row) => {
        const [partition, throttle, growth, skew] = await Promise.all([
            capture(
                getPartitionHealth(
                    monitorClient,
                    accountId,
                    'ru',
                    saturationObservation.timeRange,
                    row.databaseId,
                    row.containerId,
                    partitionThresholds,
                    saturationObservation,
                ),
            ),
            capture(
                getThrottleRate(
                    monitorClient,
                    accountId,
                    saturationObservation.timeRange,
                    row.databaseId,
                    row.containerId,
                    saturationObservation,
                ),
            ),
            capture(
                getPartitionStorageSeries(
                    monitorClient,
                    accountId,
                    storageObservation.timeRange,
                    row.databaseId,
                    row.containerId,
                    storageObservation,
                ),
            ),
            capture(
                getPartitionStorageSeries(
                    monitorClient,
                    accountId,
                    storageSkewObservation.timeRange,
                    row.databaseId,
                    row.containerId,
                    storageSkewObservation,
                ),
            ),
        ]);
        return { row, partition, throttle, growth, skew };
    });

    const partitions: PartitionSaturationInput[] = [];
    const storage: PartitionStorageResult[] = [];
    const storageSkew: PartitionStorageResult[] = [];
    for (const { row, partition, throttle, growth, skew } of partitionSignals) {
        const scope = scopeOf(row);
        const ageDays = rowAgeDays(row, accountCreatedAt, now);

        if (partition.reason) {
            addMetricFailure(metricFailures, 'SustainedThrottlingInRegion', partition.reason, scope);
            addMetricFailure(metricFailures, 'HotPartitionRisk', partition.reason, scope);
        } else if (!partition.value?.available) {
            const reason = partition.value?.reason ?? 'noData';
            addMetricFailure(metricFailures, 'SustainedThrottlingInRegion', reason, scope);
            addMetricFailure(metricFailures, 'HotPartitionRisk', reason, scope);
        } else if (throttle.reason) {
            addMetricFailure(metricFailures, 'SustainedThrottlingInRegion', throttle.reason, scope);
            addMetricFailure(metricFailures, 'HotPartitionRisk', throttle.reason, scope);
        } else if (throttle.value) {
            partitions.push({
                databaseId: row.databaseId,
                containerId: row.containerId,
                maxP99: partition.value.maxSaturationPercent ?? partition.value.topPartitionShare,
                minP99: partition.value.minSaturationPercent ?? 0,
                partitionCount: partition.value.partitionCount,
                throttleRatePercent: throttle.value.ratePercent,
                totalRequests: throttle.value.totalRequests,
                throughputMode: row.throughputMode,
                provisionedRu: row.throughputRU,
                resourceAgeDays: ageDays,
            });
        }

        if (growth.reason) {
            addMetricFailure(metricFailures, 'StorageGrowthRisk', growth.reason, scope);
        } else if (!growth.value?.available) {
            addMetricFailure(metricFailures, 'StorageGrowthRisk', growth.value?.reason ?? 'noData', scope);
        } else {
            storage.push(growth.value);
        }

        if (skew.reason) {
            addMetricFailure(metricFailures, 'StorageSkewRisk', skew.reason, scope);
        } else if (!skew.value?.available) {
            addMetricFailure(metricFailures, 'StorageSkewRisk', skew.value?.reason ?? 'noData', scope);
        } else {
            storageSkew.push(skew.value);
        }
    }

    const partitionMerges: PartitionMergeInput[] = (
        await mapInBatches(dedicatedTargets, async (row) => ({
            row,
            count: await capture(
                getContainerPartitionCount(monitorClient, accountId, row.databaseId, row.containerId, now),
            ),
            storage: await capture(
                getContainerMergeStoragePeak(monitorClient, accountId, row.databaseId, row.containerId, now),
            ),
        }))
    ).flatMap(({ row, count, storage }) => {
        const scope = scopeOf(row);
        if (count.value === undefined) {
            addMetricFailure(metricFailures, 'PartitionMergeCandidate', count.reason ?? 'noData', scope);
        }
        if (storage.value === undefined) {
            addMetricFailure(metricFailures, 'PartitionMergeCandidate', storage.reason ?? 'noData', scope);
        }
        if (count.value === undefined || storage.value === undefined) {
            return [];
        }
        return [
            {
                databaseId: row.databaseId,
                containerId: row.containerId,
                actualPartitions: count.value,
                provisionedRu: row.throughputRU,
                dataUsageBytes: storage.value,
            },
        ];
    });

    const autoscaleUtilizations = (
        await mapInBatches(autoscaleTargets, async (row) => ({
            row,
            result: await capture(
                getAutoscaleUtilization(monitorClient, accountId, row.databaseId, row.containerId, row.throughputRU!),
            ),
        }))
    ).flatMap(({ row, result }) => {
        const scope = scopeOf(row);
        if (result.reason) {
            addMetricFailure(metricFailures, 'AutoscaleMaxOverProvisioned', result.reason, scope);
            addMetricFailure(metricFailures, 'AutoscaleToManualCandidate', result.reason, scope);
            return [];
        }
        if (!result.value) {
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
                resourceAgeDays: rowAgeDays(row, accountCreatedAt, now),
            },
        ];
    });

    const serverlessThrottling = (
        await mapInBatches(serverlessTargets, async (row) => ({
            row,
            result: await capture(
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
            addMetricFailure(metricFailures, 'ServerlessThrottling', result.reason, scope);
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
        : await capture(getAccountConsumedRuShape(monitorClient, accountId));
    if (serverlessShape?.reason) {
        addMetricFailure(metricFailures, 'ServerlessCandidate', serverlessShape.reason);
    }
    const serverless: ServerlessCandidateInput | undefined = serverlessShape?.value
        ? { ...serverlessShape.value, isServerless }
        : undefined;

    const logs = await collectTier2Logs(
        logsClient,
        accountId,
        logTargets,
        offers,
        params.onLogsDiagnostic,
        dedicatedTargets,
    );

    const advisories = computeDerivedAdvisories(
        {
            manualThroughput,
            serverlessThrottling,
            storageSkew: storageSkew.map((result) => ({
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
            // Compatibility fields stay populated for older detectors, but the per-offer manual inputs above are the
            // authoritative parity path for DX-001 / DX-012.
            weeklyRuPercents: [],
            weeklyPeakPercent: undefined,
            hasManualThroughput: manualTargets.length > 0,
            manualProvisionedRuTotal: manualTargets.reduce<number | undefined>(
                (sum, row) => (sum ?? 0) + (row.throughputRU ?? 0),
                undefined,
            ),
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
            accountConfig,
            crossPartition: logs.crossPartition,
            ingestion: logs.ingestion,
            sharedThroughput: logs.sharedThroughput,
        },
        advisoryThresholds,
    );

    return {
        advisories,
        logSource: logs.logSource,
        metricSource: { available: metricFailures.length === 0, failures: metricFailures },
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
): Promise<Tier2Logs> {
    const empty = { crossPartition: [], ingestion: [], sharedThroughput: [] };
    const failures: NonNullable<LogsSourceStatus['failures']> = [];
    const report: LogsDiagnosticReporter = (diagnostic: LogsDiagnostic) => {
        if (
            !failures.some((failure) => failure.operation === diagnostic.operation && failure.kind === diagnostic.kind)
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
        report({
            operation: 'client',
            kind: 'clientUnavailable',
            reason: 'noData',
            codes: [],
            messages: ['The Log Analytics query client could not be acquired.'],
        });
        return { ...empty, logSource: coverage() };
    }

    const timespan = logWindow();
    const [dataPlane, queryRuntime] = await Promise.all([
        probeCdbLogs(logsClient, accountId, timespan, { onDiagnostic: report, table: 'CDBDataPlaneRequests' }),
        probeCdbLogs(logsClient, accountId, timespan, { onDiagnostic: report, table: 'CDBQueryRuntimeStatistics' }),
    ]);

    const sharedDatabases = new Map<string, number>();
    for (const row of rows) {
        const isDatabaseOffer = row.offerLevel === 'database';
        if (isDatabaseOffer && row.throughputRU !== undefined) {
            sharedDatabases.set(row.databaseId, row.throughputRU);
        } else if (!row.offerLevel && row.throughputMode === 'shared' && !sharedDatabases.has(row.databaseId)) {
            sharedDatabases.set(row.databaseId, row.throughputRU ?? 0);
        }
    }

    const [crossPartitionResults, ingestionResults, sharedResults] = await Promise.all([
        mapInBatches(queryRuntime.available ? scanTargets : [], (row) =>
            fetchCrossPartitionShapes(logsClient, accountId, row.databaseId, row.containerId, timespan, report).catch(
                () => undefined,
            ),
        ),
        mapInBatches(dataPlane.available ? ingestionTargets : [], (row) =>
            fetchUncontrolledIngestion(logsClient, accountId, row.databaseId, row.containerId, timespan, report).catch(
                () => undefined,
            ),
        ),
        mapInBatches(dataPlane.available ? [...sharedDatabases] : [], ([databaseId, sharedRu]) =>
            fetchSharedThroughputTraffic(logsClient, accountId, databaseId, sharedRu, timespan, report).catch(
                () => undefined,
            ),
        ),
    ]);

    return {
        crossPartition: crossPartitionResults.filter((result): result is CrossPartitionInput => result !== undefined),
        ingestion: ingestionResults.filter((result): result is UncontrolledIngestionInput => result !== undefined),
        sharedThroughput: sharedResults.filter((result): result is SharedThroughputInput => result !== undefined),
        logSource: coverage(),
    };
}
