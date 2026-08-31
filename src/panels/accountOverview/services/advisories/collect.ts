/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient } from '@azure/arm-monitor';
import { getSqlInventory, type ThroughputMode } from '../inventory';
import { getInventoryMetrics, type HealthThresholds } from '../inventoryMetrics';
import {
    getPartitionHealth,
    getPartitionStorageSeries,
    type PartitionStorageResult,
    type PartitionThresholds,
} from '../partitionHealth';
import { getRuTrends, getThrottleRate } from '../ruTrends';
import { containerKey } from '../shared';
import {
    type AccountConfigInput,
    type AutoscaleUtilizationInput,
    type CrossPartitionInput,
    type DerivedAdvisory,
    type DerivedAdvisoryThresholds,
    type IdleContainerInput,
    type IndexingUsageInput,
    type LogsSourceStatus,
    type PartitionMergeInput,
    type PartitionSaturationInput,
    type ServerlessCandidateInput,
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
import {
    getAccountConsumedRuShape,
    getAutoscaleUtilization,
    getContainerIdlePeaks,
    getContainerPartitionCounts,
} from './fetchers/metrics';

// ─── Server-side orchestration ──────────────────────────────────────────────────

/** Manual (non-autoscale, non-serverless) throughput modes that the over-provisioning/autoscale rules key on. */
const MANUAL_THROUGHPUT_MODES: ReadonlySet<ThroughputMode> = new Set<ThroughputMode>(['dedicated', 'shared']);

/** Upper bound on per-container partition-health scans per derived-advisories tick, to cap ARM reads. */
const MAX_PARTITION_SCAN = 10;

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
}

/** What {@link collectDerivedAdvisories} returns: the fired advisories plus the Tier-2 (Log Analytics) coverage status. */
export interface CollectedDerivedAdvisories {
    advisories: DerivedAdvisory[];
    logSource: LogsSourceStatus;
}

/**
 * Gathers the telemetry the derived-advisory rules need — static inventory, 24h
 * and 7d RU trends, 7d inventory metrics, and per-container partition health for
 * the busiest containers — then runs {@link computeDerivedAdvisories}. Any Azure
 * failure propagates so the router can classify it into an empty-state reason.
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

    const rows = await getSqlInventory(cosmosClient, resourceGroup, accountName, isServerless);

    const [weekTrends, inventoryMetrics, idlePeaks, partitionCounts, serverlessShape] = await Promise.all([
        getRuTrends(monitorClient, accountId, '7D', undefined, undefined),
        getInventoryMetrics(monitorClient, accountId, '7D', undefined, healthThresholds),
        // DX-004: peak consumed RU per bucket over 30 days, per container (empty ⇒ idle, not an error).
        getContainerIdlePeaks(monitorClient, accountId).catch(() => new Map<string, number>()),
        // DX-009: actual physical-partition count per container.
        getContainerPartitionCounts(monitorClient, accountId).catch(() => new Map<string, number>()),
        // DX-014: account-total consumed-RU shape over 30 days (skipped for accounts already on serverless).
        isServerless
            ? Promise.resolve(undefined)
            : getAccountConsumedRuShape(monitorClient, accountId).catch(() => undefined),
    ]);

    // Scan partition health only for the busiest containers (highest 7-day peak RU) to bound ARM reads.
    const scanTargets = [...rows]
        .sort(
            (a, b) =>
                (inventoryMetrics.metrics[containerKey(b.databaseId, b.containerId)]?.peakRuPercent ?? -1) -
                (inventoryMetrics.metrics[containerKey(a.databaseId, a.containerId)]?.peakRuPercent ?? -1),
        )
        .slice(0, MAX_PARTITION_SCAN);

    // DX-006 / DX-005 are present-tense over a 7-day window: per-physical-partition p99 saturation plus the
    // container's aggregate 429 rate, fetched together for each scanned container.
    const partitionResults = await Promise.all(
        scanTargets.map((row) =>
            getPartitionHealth(
                monitorClient,
                accountId,
                'ru',
                '7D',
                row.databaseId,
                row.containerId,
                partitionThresholds,
            ).catch(() => undefined),
        ),
    );

    const throttleResults = await Promise.all(
        scanTargets.map((row) =>
            getThrottleRate(monitorClient, accountId, '7D', row.databaseId, row.containerId).catch(() => undefined),
        ),
    );

    const storageResults = await Promise.all(
        scanTargets.map((row) =>
            getPartitionStorageSeries(monitorClient, accountId, '7D', row.databaseId, row.containerId).catch(
                () => undefined,
            ),
        ),
    );

    // DX-011 / DX-013: the AutoscaledRU-%-of-max duty cycle, fetched only for the scanned autoscale containers
    // (each is a per-container query, so bound it to the same busiest-container set as the partition scans).
    const autoscaleTargets = scanTargets.filter(
        (row) => row.throughputMode === 'autoscale' && row.throughputRU !== undefined && row.throughputRU > 0,
    );
    const autoscaleResults = await Promise.all(
        autoscaleTargets.map((row) =>
            getAutoscaleUtilization(monitorClient, accountId, row.databaseId, row.containerId, row.throughputRU!).catch(
                () => undefined,
            ),
        ),
    );

    const rowByKey = new Map(rows.map((row) => [containerKey(row.databaseId, row.containerId), row]));
    const partitions: PartitionSaturationInput[] = [];
    partitionResults.forEach((result, index) => {
        if (!result || !result.available || result.mode !== 'ru') {
            return;
        }
        const row = rowByKey.get(containerKey(result.databaseId, result.containerId));
        const throttle = throttleResults[index];
        partitions.push({
            databaseId: result.databaseId,
            containerId: result.containerId,
            maxP99: result.maxSaturationPercent ?? result.topPartitionShare,
            minP99: result.minSaturationPercent ?? 0,
            partitionCount: result.partitionCount,
            throttleRatePercent: throttle?.ratePercent ?? 0,
            totalRequests: throttle?.totalRequests ?? 0,
            throughputMode: row?.throughputMode ?? 'unknown',
            provisionedRu: row?.throughputRU,
        });
    });

    const storage = storageResults
        .filter((result): result is PartitionStorageResult => !!result && result.available)
        .map((result) => ({
            databaseId: result.databaseId,
            containerId: result.containerId,
            partitions: result.partitions,
        }));

    const indexing: IndexingUsageInput[] = rows.map((row) => {
        const metrics = inventoryMetrics.metrics[containerKey(row.databaseId, row.containerId)];
        return {
            databaseId: row.databaseId,
            containerId: row.containerId,
            indexUsageBytes: metrics?.indexUsageBytes,
            dataUsageBytes: metrics?.dataUsageBytes,
            excludedPathCount: row.excludedPathCount,
        };
    });

    const weeklyRuPercents = weekTrends.points
        .map((point) => point.ruPercent)
        .filter((value): value is number => value !== undefined);

    const manualProvisionedRuTotal = rows
        .filter((row) => MANUAL_THROUGHPUT_MODES.has(row.throughputMode) && row.throughputRU !== undefined)
        .reduce<number | undefined>((sum, row) => (sum ?? 0) + (row.throughputRU ?? 0), undefined);

    // DX-004: build an idle input for every container with a recoverable offer (manual or autoscale). A container
    // absent from the peaks map never emitted RU over the window, which is the idle signal (peak defaults to 0).
    const idleContainers: IdleContainerInput[] = rows
        .filter((row) => row.throughputRU !== undefined && row.throughputMode !== 'serverless')
        .map((row) => ({
            databaseId: row.databaseId,
            containerId: row.containerId,
            peakRuPerBucket: idlePeaks.get(containerKey(row.databaseId, row.containerId)) ?? 0,
            throughputMode: row.throughputMode,
            provisionedRu: row.throughputRU,
        }));

    // DX-009: pair each container's actual physical-partition count with its provisioned RU/s and current storage.
    const partitionMerges: PartitionMergeInput[] = rows.map((row) => {
        const metrics = inventoryMetrics.metrics[containerKey(row.databaseId, row.containerId)];
        return {
            databaseId: row.databaseId,
            containerId: row.containerId,
            actualPartitions: partitionCounts.get(containerKey(row.databaseId, row.containerId)) ?? 0,
            provisionedRu: row.throughputRU,
            dataUsageBytes: metrics?.dataUsageBytes,
        };
    });

    // DX-011 / DX-013: the fetched autoscale duty cycles, keyed back to their containers' configured max.
    const autoscaleUtilizations: AutoscaleUtilizationInput[] = [];
    autoscaleResults.forEach((result, index) => {
        if (!result) {
            return;
        }
        const row = autoscaleTargets[index];
        autoscaleUtilizations.push({
            databaseId: row.databaseId,
            containerId: row.containerId,
            peakPercent: result.peakPercent,
            avgPercent: result.avgPercent,
            sampleCount: result.sampleCount,
            configuredMaxRu: row.throughputRU,
        });
    });

    // DX-014: account-total consumed-RU shape (absent for serverless accounts or when the fetch failed).
    const serverless: ServerlessCandidateInput | undefined = serverlessShape
        ? { ...serverlessShape, isServerless }
        : undefined;

    // Materiality denominator (DX-004 / DX-011): total provisioned RU/s across the whole account.
    const scopeProvisionedRuTotal = rows.reduce<number | undefined>(
        (sum, row) => (row.throughputRU === undefined ? sum : (sum ?? 0) + row.throughputRU),
        undefined,
    );

    // Tier-2 (Log Analytics): DX-002/007 (query fan-out) and DX-010 (write-dominant throttling) for the busiest
    // scanned containers, and DX-003 (shared-throughput starvation) per shared-throughput database. Bounded to the
    // same busiest-container set as the ARM scans. Probed once so a single reason-specific partial-coverage notice
    // is surfaced when logs are unavailable, and Tier-1 still ships.
    const logs = await collectTier2Logs(logsClient, accountId, scanTargets, rows);

    const advisories = computeDerivedAdvisories(
        {
            weeklyRuPercents,
            weeklyPeakPercent: weekTrends.peakPercent,
            hasManualThroughput: rows.some((row) => MANUAL_THROUGHPUT_MODES.has(row.throughputMode)),
            manualProvisionedRuTotal,
            partitions,
            storage,
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

    return { advisories, logSource: logs.logSource };
}

/** The Tier-2 inputs gathered from Log Analytics plus the coverage status the card surfaces. */
interface Tier2Logs {
    crossPartition: CrossPartitionInput[];
    ingestion: UncontrolledIngestionInput[];
    sharedThroughput: SharedThroughputInput[];
    logSource: LogsSourceStatus;
}

/**
 * Fetches the Tier-2 (Log Analytics) inputs for the busiest scanned containers and shared-throughput databases,
 * degrading gracefully: with no client Tier-2 is reported unavailable (`noData`); if the `CDB*` tables are not
 * queryable the probe classifies why (`logAnalyticsDisabled` / `rbac` / `noData`) and no per-detector queries run.
 * Individual query failures degrade that detector to empty rather than failing the whole section.
 */
async function collectTier2Logs(
    logsClient: LogsQueryExecutor | undefined,
    accountId: string,
    scanTargets: readonly { databaseId: string; containerId: string }[],
    rows: readonly { databaseId: string; containerId: string; throughputMode: ThroughputMode; throughputRU?: number }[],
): Promise<Tier2Logs> {
    const empty = { crossPartition: [], ingestion: [], sharedThroughput: [] };
    if (!logsClient) {
        return { ...empty, logSource: { available: false, reason: 'noData' } };
    }

    const timespan = logWindow();
    const probe = await probeCdbLogs(logsClient, accountId, timespan);
    if (!probe.available) {
        return { ...empty, logSource: { available: false, reason: probe.reason } };
    }

    // DX-003: one query per shared-throughput database (deduped), using the shared pool's provisioned RU/s.
    const sharedDatabases = new Map<string, number>();
    for (const row of rows) {
        if (row.throughputMode === 'shared' && !sharedDatabases.has(row.databaseId)) {
            sharedDatabases.set(row.databaseId, row.throughputRU ?? 0);
        }
    }

    const [crossPartitionResults, ingestionResults, sharedResults] = await Promise.all([
        Promise.all(
            scanTargets.map((row) =>
                fetchCrossPartitionShapes(logsClient, accountId, row.databaseId, row.containerId, timespan).catch(
                    () => undefined,
                ),
            ),
        ),
        Promise.all(
            scanTargets.map((row) =>
                fetchUncontrolledIngestion(logsClient, accountId, row.databaseId, row.containerId, timespan).catch(
                    () => undefined,
                ),
            ),
        ),
        Promise.all(
            [...sharedDatabases].map(([databaseId, sharedRu]) =>
                fetchSharedThroughputTraffic(logsClient, accountId, databaseId, sharedRu, timespan).catch(
                    () => undefined,
                ),
            ),
        ),
    ]);

    return {
        crossPartition: crossPartitionResults.filter((r): r is CrossPartitionInput => r !== undefined),
        ingestion: ingestionResults.filter((r): r is UncontrolledIngestionInput => r !== undefined),
        sharedThroughput: sharedResults.filter((r): r is SharedThroughputInput => r !== undefined),
        logSource: { available: true },
    };
}
