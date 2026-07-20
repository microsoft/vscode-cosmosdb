/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient } from '@azure/arm-monitor';
import * as l10n from '@vscode/l10n';
import { getSqlInventory, type ThroughputMode } from './inventory';
import { getInventoryMetrics, type HealthThresholds } from './inventoryMetrics';
import {
    getPartitionHealth,
    type PartitionHealthResult,
    type PartitionThresholds,
} from './partitionHealth';
import { getRuTrends, type RuTrendPoint } from './ruTrends';
import { bucketMsForRange, containerKey, MINUTE, type UnavailableReason } from './shared';

// ─── Client-side derived advisories ──────────────────────────────────────────────
//
// Unlike Azure Alerts + Advisor recommendations, these advisories are derived on
// the extension host from telemetry the dashboard has already fetched (RU trends,
// inventory metrics, partition health). No new ARM endpoints. The portal does not
// derive these on its Overview blade, so thresholds are advisory and user-tunable
// via `cosmosDB.accountOverview.advisories.*`. Every rule function is pure so it
// can be unit-tested against synthetic inputs; `collectDerivedAdvisories` does the
// fetching and calls `computeDerivedAdvisories`.

/** The five derived-advisory rules this engine implements (P0 + best-effort). */
export type DerivedAdvisoryRule =
    | 'HotPartitionRisk'
    | 'SustainedThrottlingInRegion'
    | 'OverProvisioning'
    | 'AutoscaleCandidate'
    | 'IndexingCostRisk';

export type DerivedAdvisorySeverity = 'High' | 'Medium' | 'Low';

export interface DerivedAdvisory {
    /** Stable id (rule + optional scope) so the webview can dismiss it for the session. */
    id: string;
    rule: DerivedAdvisoryRule;
    severity: DerivedAdvisorySeverity;
    title: string;
    /** Why this fired; ≤ 500 chars. */
    rationale: string;
    suggestedAction: string;
    /** Human-readable reference to the configured threshold that fired the rule. */
    thresholdReference: string;
    /** `databaseId/containerId` this advisory concerns, when container-scoped. */
    scope?: string;
}

export interface DerivedAdvisoriesResult {
    /** False when none of the underlying telemetry was available to evaluate. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    advisories: DerivedAdvisory[];
    /** Epoch milliseconds when the server produced this snapshot. */
    generatedAt: number;
}

/** Thresholds for the derived-advisory rules, sourced from `cosmosDB.accountOverview.*`. */
export interface DerivedAdvisoryThresholds {
    /**
     * Fair-share multiple (busiest partition's RU share ÷ its even-split baseline `1/partitionCount`) at or above
     * which HotPartitionRisk fires. Partition-count-independent: 1.0 is a perfectly balanced container, so a value
     * of 3 flags a partition pulling three times its fair share regardless of how many partitions exist.
     */
    hotPartitionFairShareMultiple: number;
    /** Continuous throttling duration (minutes) that fires SustainedThrottlingInRegion. */
    throttlingMinMinutes: number;
    /** 7-day peak RU (%) below which OverProvisioning fires. */
    overProvisioningPeakPercent: number;
    /** RU coefficient of variation above which AutoscaleCandidate fires. */
    autoscaleCoefficientOfVariation: number;
    /** Index/data storage ratio above which IndexingCostRisk fires. */
    indexingUsageRatio: number;
}

export const DEFAULT_ADVISORY_THRESHOLDS: DerivedAdvisoryThresholds = {
    hotPartitionFairShareMultiple: 3,
    throttlingMinMinutes: 30,
    overProvisioningPeakPercent: 25,
    autoscaleCoefficientOfVariation: 0.5,
    indexingUsageRatio: 0.3,
};

const ADVISORY_SEVERITY_ORDER: Record<DerivedAdvisorySeverity, number> = { High: 0, Medium: 1, Low: 2 };

/** Sorts advisories by severity (High first), then rule, then scope. Pure. */
export function compareAdvisories(a: DerivedAdvisory, b: DerivedAdvisory): number {
    return (
        ADVISORY_SEVERITY_ORDER[a.severity] - ADVISORY_SEVERITY_ORDER[b.severity] ||
        a.rule.localeCompare(b.rule) ||
        (a.scope ?? '').localeCompare(b.scope ?? '')
    );
}

/** Defensive clamp so a rationale never exceeds the 500-char budget. */
function clampRationale(text: string): string {
    return text.length <= 500 ? text : text.slice(0, 499) + '…';
}

/**
 * Longest run of consecutive throttled buckets expressed in milliseconds. Each
 * bucket spans `bucketMs`, so a run of N throttled buckets is `N * bucketMs`.
 * Pure.
 */
export function longestThrottledRunMs(points: readonly RuTrendPoint[], bucketMs: number): number {
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    let longest = 0;
    let current = 0;
    for (const point of sorted) {
        if (point.throttled) {
            current += 1;
            longest = Math.max(longest, current);
        } else {
            current = 0;
        }
    }
    return longest * Math.max(0, bucketMs);
}

/** Coefficient of variation (stdDev / mean) of a numeric series; 0 for an empty or zero-mean series. Pure. */
export function coefficientOfVariation(values: readonly number[]): number {
    const clean = values.filter((v) => Number.isFinite(v));
    if (clean.length === 0) {
        return 0;
    }
    const mean = clean.reduce((sum, v) => sum + v, 0) / clean.length;
    if (mean === 0) {
        return 0;
    }
    const variance = clean.reduce((sum, v) => sum + (v - mean) ** 2, 0) / clean.length;
    return Math.sqrt(variance) / mean;
}

/**
 * Fair-share multiple of a partition's RU share: its share divided by the
 * even-split baseline `1/partitionCount`. Equals `share × partitionCount / 100`
 * (share is a percentage). 1.0 is a perfectly balanced container regardless of
 * partition count; returns 0 for a single-partition (or empty) container, which
 * cannot be skewed. Pure.
 */
export function fairShareMultiple(topPartitionShare: number, partitionCount: number): number {
    if (partitionCount < 2 || topPartitionShare <= 0) {
        return 0;
    }
    return (topPartitionShare * partitionCount) / 100;
}

/**
 * HotPartitionRisk (P0): the busiest physical partition in a container pulls a
 * multiple of its even-split fair share (`share ÷ (1/partitionCount)`) at or
 * above the configured threshold. Unlike a raw share cutoff, this is
 * partition-count-independent — a balanced two-partition split (50/50, multiple
 * 1.0) never fires, while one partition at 35% of a 20-partition container
 * (multiple 7.0) does. Pure.
 */
export function evaluateHotPartitionRisk(
    databaseId: string,
    containerId: string,
    topPartitionShare: number,
    partitionCount: number,
    multipleThreshold: number,
): DerivedAdvisory | undefined {
    if (multipleThreshold <= 0) {
        return undefined;
    }
    const multiple = fairShareMultiple(topPartitionShare, partitionCount);
    if (multiple < multipleThreshold) {
        return undefined;
    }
    const scope = containerKey(databaseId, containerId);
    const share = Math.round(topPartitionShare);
    const times = Math.round(multiple * 10) / 10;
    const threshold = Math.round(multipleThreshold * 10) / 10;
    return {
        id: `HotPartitionRisk:${scope}`,
        rule: 'HotPartitionRisk',
        severity: 'High',
        title: l10n.t('Hot physical partition in {container}', { container: containerId }),
        rationale: clampRationale(
            l10n.t(
                'The busiest physical partition in "{container}" handled {share}% of request units over the last hour across {count} physical partitions — {times}× its even-split fair share, at or above the {threshold}× hot-partition threshold. A single hot partition caps effective throughput and can trigger 429s even when the container is provisioned for more.',
                { container: containerId, share, count: partitionCount, times, threshold },
            ),
        ),
        suggestedAction: l10n.t(
            'Review the partition key for a higher-cardinality choice, or split hot logical keys so traffic spreads evenly across partitions.',
        ),
        thresholdReference: l10n.t('Threshold: busiest partition ≥ {threshold}× fair share for ≥ 1h', { threshold }),
        scope,
    };
}

/**
 * SustainedThrottlingInRegion / UnderProvisioning (P0): requests were throttled
 * (HTTP 429) continuously for at least the configured duration. Pure.
 */
export function evaluateSustainedThrottling(longestRunMs: number, minMinutes: number): DerivedAdvisory | undefined {
    const minMs = minMinutes * MINUTE;
    if (minMs <= 0 || longestRunMs < minMs) {
        return undefined;
    }
    const minutes = Math.round(longestRunMs / MINUTE);
    return {
        id: 'SustainedThrottlingInRegion',
        rule: 'SustainedThrottlingInRegion',
        severity: 'High',
        title: l10n.t('Sustained throttling detected'),
        rationale: clampRationale(
            l10n.t(
                'Requests were throttled (HTTP 429) continuously for about {minutes} minutes in the last 24 hours, at or beyond the {min}-minute sustained-throttling threshold. Prolonged 429s usually mean the workload is under-provisioned for its peak, or traffic concentrates on a single partition.',
                { minutes, min: minMinutes },
            ),
        ),
        suggestedAction: l10n.t(
            'Increase provisioned throughput (or enable autoscale) for the affected containers, or smooth traffic with client-side retries and batching.',
        ),
        thresholdReference: l10n.t('Threshold: throttling ≥ {min} continuous minutes', { min: minMinutes }),
    };
}

/**
 * OverProvisioning (best-effort): sustained low peak RU on manual throughput
 * over the trailing 7 days. Pure.
 */
export function evaluateOverProvisioning(
    peakPercent: number | undefined,
    thresholdPercent: number,
    hasManualThroughput: boolean,
): DerivedAdvisory | undefined {
    if (!hasManualThroughput || peakPercent === undefined || peakPercent >= thresholdPercent) {
        return undefined;
    }
    const peak = Math.round(peakPercent);
    const threshold = Math.round(thresholdPercent);
    return {
        id: 'OverProvisioning',
        rule: 'OverProvisioning',
        severity: 'Medium',
        title: l10n.t('Throughput may be over-provisioned'),
        rationale: clampRationale(
            l10n.t(
                'Peak normalized RU consumption stayed at {peak}% over the last 7 days, below the {threshold}% over-provisioning threshold, while at least one container uses manual throughput. Consistently low utilization means you are paying for capacity the workload never uses.',
                { peak, threshold },
            ),
        ),
        suggestedAction: l10n.t(
            'Lower provisioned RU/s to match observed demand, or switch to autoscale so capacity tracks usage automatically.',
        ),
        thresholdReference: l10n.t('Threshold: 7-day peak < {threshold}% RU', { threshold }),
    };
}

/**
 * AutoscaleCandidate (best-effort): highly variable RU on manual throughput.
 * Pure.
 */
export function evaluateAutoscaleCandidate(
    cov: number,
    threshold: number,
    hasManualThroughput: boolean,
): DerivedAdvisory | undefined {
    if (!hasManualThroughput || cov <= threshold) {
        return undefined;
    }
    return {
        id: 'AutoscaleCandidate',
        rule: 'AutoscaleCandidate',
        severity: 'Medium',
        title: l10n.t('Workload looks like an autoscale candidate'),
        rationale: clampRationale(
            l10n.t(
                'RU consumption over the last 7 days is highly variable (coefficient of variation {cov}, above the {threshold} threshold) while at least one container uses manual throughput. Spiky traffic on fixed throughput risks throttling at peaks and waste at troughs.',
                { cov: cov.toFixed(2), threshold: threshold.toFixed(2) },
            ),
        ),
        suggestedAction: l10n.t(
            'Enable autoscale on the variable containers so provisioned RU/s follows demand between the configured floor and ceiling.',
        ),
        thresholdReference: l10n.t('Threshold: RU variability (stdDev/mean) > {threshold}', {
            threshold: threshold.toFixed(2),
        }),
    };
}

/** Per-container storage inputs for the IndexingCostRisk rule. */
export interface IndexingUsageInput {
    databaseId: string;
    containerId: string;
    /** Latest `IndexUsage` bytes for the container, when reported. */
    indexUsageBytes?: number;
    /** Latest `DataUsage` bytes for the container, when reported. */
    dataUsageBytes?: number;
    /** Number of paths excluded from indexing (0 ⇒ indexes everything). */
    excludedPathCount: number;
}

/**
 * IndexingCostRisk (best-effort): index storage is a large fraction of data
 * storage AND the container excludes no paths (indexes everything). Pure.
 */
export function evaluateIndexingCostRisk(
    input: IndexingUsageInput,
    ratioThreshold: number,
): DerivedAdvisory | undefined {
    const { indexUsageBytes, dataUsageBytes, excludedPathCount } = input;
    if (
        excludedPathCount > 0 ||
        dataUsageBytes === undefined ||
        dataUsageBytes <= 0 ||
        indexUsageBytes === undefined ||
        indexUsageBytes < 0
    ) {
        return undefined;
    }
    const ratio = indexUsageBytes / dataUsageBytes;
    if (ratio <= ratioThreshold) {
        return undefined;
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const percent = Math.round(ratio * 100);
    const threshold = Math.round(ratioThreshold * 100);
    return {
        id: `IndexingCostRisk:${scope}`,
        rule: 'IndexingCostRisk',
        severity: 'Low',
        title: l10n.t('High indexing overhead in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'Index storage in "{container}" is {percent}% of its data size, above the {threshold}% threshold, and the container indexes every path (no exclusions). Indexing every property inflates storage and the RU cost of every write.',
                { container: input.containerId, percent, threshold },
            ),
        ),
        suggestedAction: l10n.t(
            'Exclude paths that are never used in filters from the indexing policy to cut write RU charges and index storage.',
        ),
        thresholdReference: l10n.t('Threshold: index/data storage > {threshold}%', { threshold }),
        scope,
    };
}

/** Already-fetched telemetry the derived-advisory engine consumes. */
export interface DerivedAdvisoryInputs {
    /** Account-wide RU trend points for the sustained-throttling rule (typically the last 24h). */
    throttlingPoints: readonly RuTrendPoint[];
    /** Bucket size (ms) for `throttlingPoints`, used to convert a run of buckets to a duration. */
    throttlingBucketMs: number;
    /** Account-wide 7-day RU% samples for the over-provisioning + autoscale rules. */
    weeklyRuPercents: readonly number[];
    /** Max of `weeklyRuPercents`, or undefined when no 7-day data is available. */
    weeklyPeakPercent?: number;
    /** True when at least one container/database uses manual (non-autoscale, non-serverless) throughput. */
    hasManualThroughput: boolean;
    /** Per-container top physical-partition RU share (and partition count) over the last hour. */
    partitions: readonly { databaseId: string; containerId: string; topPartitionShare: number; partitionCount: number }[];
    /** Per-container index/data storage for the indexing-cost rule. */
    indexing: readonly IndexingUsageInput[];
}

/**
 * Runs every derived-advisory rule over already-fetched telemetry and returns the advisories
 * that fired, sorted by severity. Pure so the whole engine is unit-testable.
 */
export function computeDerivedAdvisories(
    inputs: DerivedAdvisoryInputs,
    thresholds: DerivedAdvisoryThresholds,
): DerivedAdvisory[] {
    const advisories: DerivedAdvisory[] = [];

    for (const partition of inputs.partitions) {
        const advisory = evaluateHotPartitionRisk(
            partition.databaseId,
            partition.containerId,
            partition.topPartitionShare,
            partition.partitionCount,
            thresholds.hotPartitionFairShareMultiple,
        );
        if (advisory) {
            advisories.push(advisory);
        }
    }

    const throttling = evaluateSustainedThrottling(
        longestThrottledRunMs(inputs.throttlingPoints, inputs.throttlingBucketMs),
        thresholds.throttlingMinMinutes,
    );
    if (throttling) {
        advisories.push(throttling);
    }

    const overProvisioning = evaluateOverProvisioning(
        inputs.weeklyPeakPercent,
        thresholds.overProvisioningPeakPercent,
        inputs.hasManualThroughput,
    );
    if (overProvisioning) {
        advisories.push(overProvisioning);
    }

    const autoscale = evaluateAutoscaleCandidate(
        coefficientOfVariation(inputs.weeklyRuPercents),
        thresholds.autoscaleCoefficientOfVariation,
        inputs.hasManualThroughput,
    );
    if (autoscale) {
        advisories.push(autoscale);
    }

    for (const indexing of inputs.indexing) {
        const advisory = evaluateIndexingCostRisk(indexing, thresholds.indexingUsageRatio);
        if (advisory) {
            advisories.push(advisory);
        }
    }

    advisories.sort(compareAdvisories);
    return advisories;
}

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
}

/**
 * Gathers the telemetry the derived-advisory rules need — static inventory, 24h
 * and 7d RU trends, 7d inventory metrics, and per-container partition health for
 * the busiest containers — then runs {@link computeDerivedAdvisories}. Any Azure
 * failure propagates so the router can classify it into an empty-state reason.
 */
export async function collectDerivedAdvisories(params: CollectDerivedAdvisoriesParams): Promise<DerivedAdvisory[]> {
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
    } = params;

    const rows = await getSqlInventory(cosmosClient, resourceGroup, accountName, isServerless);

    const [dayTrends, weekTrends, inventoryMetrics] = await Promise.all([
        getRuTrends(monitorClient, accountId, '24H', undefined, undefined),
        getRuTrends(monitorClient, accountId, '7D', undefined, undefined),
        getInventoryMetrics(monitorClient, accountId, '7D', undefined, healthThresholds),
    ]);

    // Scan partition health only for the busiest containers (highest 7-day peak RU) to bound ARM reads.
    const scanTargets = [...rows]
        .sort(
            (a, b) =>
                (inventoryMetrics.metrics[containerKey(b.databaseId, b.containerId)]?.peakRuPercent ?? -1) -
                (inventoryMetrics.metrics[containerKey(a.databaseId, a.containerId)]?.peakRuPercent ?? -1),
        )
        .slice(0, MAX_PARTITION_SCAN);

    const partitionResults = await Promise.all(
        scanTargets.map((row) =>
            getPartitionHealth(
                monitorClient,
                accountId,
                'ru',
                '1H',
                row.databaseId,
                row.containerId,
                partitionThresholds,
            ).catch(() => undefined),
        ),
    );

    const partitions = partitionResults
        .filter((result): result is PartitionHealthResult => !!result && result.available)
        .map((result) => ({
            databaseId: result.databaseId,
            containerId: result.containerId,
            topPartitionShare: result.topPartitionShare,
            partitionCount: result.partitionCount,
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

    return computeDerivedAdvisories(
        {
            throttlingPoints: dayTrends.points,
            throttlingBucketMs: bucketMsForRange('24H'),
            weeklyRuPercents,
            weeklyPeakPercent: weekTrends.peakPercent,
            hasManualThroughput: rows.some((row) => MANUAL_THROUGHPUT_MODES.has(row.throughputMode)),
            partitions,
            indexing,
        },
        advisoryThresholds,
    );
}
