/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type API } from '../../../../../AzureDBExperiences';
import { type ThroughputMode } from '../../inventory';
import { type PartitionStorageSeries } from '../../partitionHealth';
import { type UnavailableReason } from '../../shared';
import { type LogsFailureKind, type LogsOperation } from '../fetchers/logsDiagnostics';
import { type OperationCategory } from './requestMetrics';

// ─── Client-side derived advisories ──────────────────────────────────────────────
//
// Unlike Azure Alerts + Advisor recommendations, these advisories are derived on
// the extension host from telemetry the dashboard has already fetched (RU trends,
// inventory metrics, partition health and account request metrics), plus optional diagnostic logs. The portal does not
// derive these on its Overview blade. Thresholds follow the internal CODA-governed policy, not VS Code settings.
// Every rule function is pure so it can be unit-tested against synthetic inputs; collectDerivedAdvisories does
// the fetching and calls computeDerivedAdvisories.

/** The derived-advisory rules this engine implements (P0 + best-effort). */
export type DerivedAdvisoryRule =
    | 'HotPartitionRisk'
    | 'SustainedThrottlingInRegion'
    | 'OverProvisioning'
    | 'AutoscaleCandidate'
    | 'StorageGrowthRisk'
    | 'StorageSkewRisk'
    | 'IndexingCostRisk'
    | 'ExpensiveConsistency'
    | 'MultiRegionWriteAntipattern'
    | 'IdleContainer'
    | 'PartitionMergeCandidate'
    | 'AutoscaleMaxOverProvisioned'
    | 'AutoscaleToManualCandidate'
    | 'ServerlessCandidate'
    | 'ServerlessThrottling'
    | 'CrossPartitionQuery'
    | 'ShardKeyMisalignment'
    | 'UncontrolledIngestion'
    | 'SharedThroughputStarvation'
    | 'PaidContinuousBackup'
    | 'NonThrottlingErrors'
    | 'ThrottlingByOperation'
    | 'PerRegionAutoscaleCandidate'
    | 'ReservedCapacityCandidate';

export type DerivedAdvisorySeverity = 'High' | 'Medium' | 'Low';

export type UtilizationBand = 'idle' | 'low' | 'moderate' | 'ok' | 'insufficient_data';

/** Production sizing observations remain inspectable even when a finding is withheld. */
export interface ProvisioningEvaluation {
    band: UtilizationBand;
    recommendedRu?: number;
    recoverableRu?: number;
    advisory?: DerivedAdvisory;
}

export interface RequestErrorEvaluation {
    rootCause: 'too_few_requests' | 'clean' | 'has_errors';
    errorRatePercent: number;
    dominantStatus?: number;
    advisory?: DerivedAdvisory;
}

type EvaluationOutcome<RootCause extends string, Observations = never> = { rootCause: RootCause } & ([
    Observations,
] extends [never]
    ? { observations?: never }
    : { observations: Observations });

interface AdvisoryEvaluationResults {
    AutoscaleCandidate: EvaluationOutcome<'insufficient_data' | 'spiky_manual' | 'well_matched'>;
    AutoscaleToManualCandidate: EvaluationOutcome<'insufficient_data' | 'well_matched' | 'steady_autoscale'>;
    CrossPartitionQuery: EvaluationOutcome<
        | 'insufficient_data'
        | 'single_partition_container'
        | 'mostly_single_partition'
        | 'occasional_fanout'
        | 'cross_partition'
    >;
    ExpensiveConsistency: EvaluationOutcome<
        'unknown' | 'default_or_relaxed' | 'single_region' | 'strong_single_region' | 'premium_multi_region'
    >;
    HotPartitionRisk: EvaluationOutcome<
        'insufficient_data' | 'single_partition' | 'not_saturated' | 'uniform_saturation' | 'hot_partition'
    >;
    IdleContainer:
        | EvaluationOutcome<'insufficient_data' | 'active'>
        | EvaluationOutcome<'idle', { recoverableRu: number }>;
    IndexingCostRisk:
        | EvaluationOutcome<'indexing_disabled' | 'insufficient_data'>
        | EvaluationOutcome<
              'normal_ratio' | 'high_index_ratio',
              { indexDataRatio: number; userExcludedPathCount: number }
          >;
    MultiRegionWriteAntipattern: {
        rootCause:
            | 'not_multi_region_writes'
            | `${'cassandra' | 'gremlin' | 'table' | 'mongo'}_multi_region_writes`
            | 'single_region_multi_region_writes_tripwire'
            | 'legitimate_ha'
            | 'nonprod_multi_region_writes';
        observations?:
            | { regionalCapacityQuantified: false }
            | {
                  regionalCapacityQuantified: true;
                  configuredPerRegionRu: number;
                  globalRegionalFootprintRu: number;
                  removableExtraRegionRu: number | null;
              };
    };
    PaidContinuousBackup: EvaluationOutcome<
        | 'periodic_backup'
        | 'unknown'
        | 'uncharged_7day_backup'
        | 'unknown_continuous_tier'
        | 'legitimate_prod_backup'
        | 'nonprod_paid_continuous_backup'
    >;
    PartitionMergeCandidate:
        | EvaluationOutcome<'insufficient_data' | 'single_partition' | 'right_sized'>
        | EvaluationOutcome<
              'over_partitioned',
              {
                  mergeEligibility:
                      | 'blocked_pitr'
                      | 'blocked_full_fidelity'
                      | 'requires_platform_validation'
                      | 'unknown';
              }
          >;
    PerRegionAutoscaleCandidate: EvaluationOutcome<
        'serverless' | 'unknown' | 'single_region' | 'already_enabled' | 'prpa_candidate'
    >;
    ReservedCapacityCandidate: EvaluationOutcome<'serverless' | 'unknown' | 'below_baseline' | 'reserved_candidate'>;
    ServerlessCandidate: EvaluationOutcome<
        | 'already_serverless'
        | 'insufficient_data'
        | 'idle_or_empty'
        | 'too_high'
        | 'steady_load'
        | 'serverless_candidate'
    >;
    ServerlessThrottling:
        | EvaluationOutcome<'insufficient_data' | 'not_throttling'>
        | EvaluationOutcome<'serverless_throttling', { throttleRatePercent: number }>;
    ShardKeyMisalignment: EvaluationOutcome<'insufficient_data' | 'not_misaligned' | 'shard_key_misaligned'>;
    SharedThroughputStarvation:
        | EvaluationOutcome<'insufficient_data' | 'single_collection' | 'not_throttling' | 'no_disparity'>
        | EvaluationOutcome<'starvation', { monopolizer: string; victim: string }>;
    StorageGrowthRisk:
        | EvaluationOutcome<'insufficient_data' | 'too_small' | 'stable'>
        | EvaluationOutcome<'at_or_over_limit' | 'rapid_growth', { daysToLimit: number }>;
    StorageSkewRisk: EvaluationOutcome<
        'insufficient_data' | 'single_partition' | 'uniform_storage' | 'too_small' | 'storage_skew'
    >;
    SustainedThrottlingInRegion: EvaluationOutcome<
        'insufficient_data' | 'not_throttling' | 'skew_suspected' | 'global_under_provisioning'
    >;
    ThrottlingByOperation:
        | EvaluationOutcome<'too_few_requests' | 'not_throttling'>
        | EvaluationOutcome<
              'decomposed',
              {
                  totalRequests: number;
                  totalThrottled: number;
                  throttleRatePercent: number;
                  dominantOperation: string;
                  dominantCategory: OperationCategory;
                  dominantSharePercent: number;
              } & Partial<Record<`${OperationCategory}SharePercent`, number>>
          >;
    UncontrolledIngestion: EvaluationOutcome<'insufficient_data' | 'not_uncontrolled' | 'uncontrolled_ingestion'>;
}

export type AdvisoryEvaluation<Rule extends keyof AdvisoryEvaluationResults = keyof AdvisoryEvaluationResults> =
    AdvisoryEvaluationResults[Rule] & {
        advisory?: DerivedAdvisory;
        /** A diagnostic classification can have severity without emitting this rule's finding. */
        severity?: DerivedAdvisorySeverity;
    };

export interface DerivedAdvisory {
    /** Stable id (rule + optional scope) so the webview can dismiss it for the session. */
    id: string;
    rule: DerivedAdvisoryRule;
    severity: DerivedAdvisorySeverity;
    title: string;
    /** Why this fired; ≤ 500 chars. Inline backticks mark values with units; literal data is escaped. */
    rationale: string;
    /** Human-readable action using the same inline-backtick convention as rationale. */
    suggestedAction: string;
    /** Human-readable reference to the configured threshold; supports inline-backtick highlights. */
    thresholdReference: string;
    /** `databaseId/containerId` this advisory concerns, when container-scoped. */
    scope?: string;
    /** Retained for diagnostic provenance, but hidden from the default actionable list. */
    supersededBy?: string;
    /** Machine-readable observed/modelled values, separate from localized presentation. Not telemetry. */
    evidence?: Record<string, number | string | boolean | null>;
    /** Structural findings can remain visible while a proposed action is blocked or unverified. */
    actionEligibility?: 'requiresValidation' | 'blocked' | 'unknown';
    /** Conditional investigation guidance, not a confirmed application antipattern or authorization to remediate. */
    agentKitRule?: string | null;
    /** Optional financial enrichment; never changes the detector's decision, severity or supersession. */
    costEstimate?: AdvisoryCostEstimate;
}

export interface ThroughputRate {
    source: 'customerAmortizedBill';
    scope: 'account';
    currency: string;
    cost: number;
    usage100RuHours: number;
    meters: string[];
    observationStart: string;
    observationEnd: string;
    perRuMonth: number;
}

export interface BackupPrice {
    region: string;
    perGbMonth: number;
    meterId: string;
    effectiveStart: string;
    effectiveEnd?: string;
}

export type AdvisoryCostEstimate = {
    monthlyAmount: number;
    currency: string;
} & (
    | { basis: 'customerAmortizedBill'; recoverableRu: number; rate: ThroughputRate }
    | {
          basis: 'azureRetailPrice';
          storageBytes: number;
          snapshotAt: string;
          referenceRegion: string;
          logicalContainers: number;
          prices: BackupPrice[];
      }
);

export type CostFailureKind =
    | 'notConfigured'
    | 'authentication'
    | 'accessDenied'
    | 'rateLimited'
    | 'timeout'
    | 'serviceError'
    | 'queryError'
    | 'invalidData'
    | 'noData'
    | 'unsupported';

/** Optional financial coverage is separate from detector coverage. No raw service errors or billing rows. */
export interface CostSourceStatus {
    available: boolean;
    failures: { operation: 'throughput' | 'backup'; kind: CostFailureKind }[];
}

/**
 * Per-tier availability of the Log Analytics ("Tier-2") data path, so the card can render the Tier-1
 * advisories that *did* run while flagging that the log-based analyzers were skipped. This is the
 * partial-coverage contract: Tier-2 degrading must never blank the whole card (which always has
 * Tier-1 metrics + config advisories to show).
 */
export interface LogsSourceStatus {
    /** True when both required tables and all attempted detector queries succeeded, even if empty. */
    available: boolean;
    /** When false, the highest-priority failure reason. Successful log-based checks still contribute findings. */
    reason?: UnavailableReason;
    /** Bounded categories only; raw service errors, resource identifiers and query text stay out of the webview. */
    failures?: { operation: LogsOperation; kind: LogsFailureKind; reason: UnavailableReason }[];
}

/** Missing metric/configuration evidence stays distinguishable from successful checks with no finding. */
export interface MetricSourceStatus {
    available: boolean;
    failures: { rule: DerivedAdvisoryRule; scope?: string; reason: UnavailableReason }[];
}

export interface DerivedAdvisoriesResult {
    /** False when none of the underlying telemetry was available to evaluate. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac` | `logAnalyticsDisabled`. */
    reason?: UnavailableReason;
    advisories: DerivedAdvisory[];
    /**
     * Availability of the Log Analytics ("Tier-2") analyzers, present when the section itself is available.
     * `available: true` means all attempted log queries completed; absent means coverage was not reported.
     * `available: false` drives a partial-coverage notice while successful findings still render.
     */
    logSource?: LogsSourceStatus;
    metricSource?: MetricSourceStatus;
    costSource?: CostSourceStatus;
    /** Epoch milliseconds when the server produced this snapshot. */
    generatedAt: number;
}

/** Thresholds for the derived-advisory rules, sourced from `cosmosDB.accountOverview.*`. */
export interface DerivedAdvisoryThresholds {
    /**
     * RU: a physical partition's p99 (% of provisioned) at or above which it counts as saturated. Drives both the
     * HotPartitionRisk (DX-006) and SustainedThrottlingInRegion (DX-005) rules — a container is only flagged when a
     * partition is actually at capacity.
     */
    partitionSaturationPercent: number;
    /**
     * RU: a physical partition's p99 below which it still has headroom. A saturated busiest partition *with* a
     * cooler sibling below this is a hot partition (DX-006, re-key); every partition at/above this is uniform
     * under-provisioning (DX-005, add RU/s).
     */
    partitionHeadroomPercent: number;
    /** Container 429 rate (`sum(429)/sum(total)`, %) at or above which throttling counts as active. */
    throttleRatePercent: number;
    /** Per-offer 30-day p99 RU (%) below which OverProvisioning fires (CODA DX-001 moderate band). */
    overProvisioningBandPercent: number;
    /** Peak RU (%) a workload must reach for AutoscaleCandidate — below this you should right-size, not autoscale. */
    autoscaleMaxPercent: number;
    /** Average RU (%) a workload must stay at or below for AutoscaleCandidate (mostly idle between bursts). */
    autoscaleAvgPercent: number;
    /** Peak-to-average RU ratio at or above which AutoscaleCandidate fires (a genuine burst, not steady load). */
    autoscalePeakToAvgRatio: number;
    /**
     * Projected days-to-limit horizon at or below which StorageGrowthRisk fires. A physical partition whose
     * least-squares storage trajectory reaches the 50 GiB split ceiling within this many days is flagged; severity
     * grades by how soon (≤ 30 d High, ≤ 90 d Medium, otherwise Low).
     */
    storageGrowthHorizonDays: number;
    /**
     * Balance ratio (coolest physical partition size ÷ busiest) below which, when the busiest partition is also
     * material, StorageSkewRisk fires. 1.0 is perfectly balanced; a low value means one partition holds far more
     * than its siblings and will hit the split ceiling long before they do.
     */
    storageSkewBalanceRatio: number;
    /** Index/data storage ratio above which IndexingCostRisk fires. */
    indexingUsageRatio: number;
    /**
     * RU: peak RU consumed in any single bucket (max of `TotalRequestUnits`, Total) at or below which a container
     * counts as idle (DX-004). A container that never spends more than this near-zero floor in any bucket over the
     * 30-day window did no real work — its whole reservation (manual) or idle floor (autoscale) is recoverable.
     */
    idlePeakRuPerBucket: number;
    /**
     * Autoscale utilisation (average % of the configured max) at or above which AutoscaleToManualCandidate (DX-013)
     * fires — a workload sustained near its max barely uses autoscale's elasticity and is cheaper on manual. Grounded
     * in Azure's autoscale break-even: autoscale only saves money if `Tmax` is used 66% or fewer hours per month.
     * https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale#benefits-of-autoscale
     */
    autoscaleToManualAvgPercent: number;
    /**
     * Peak-to-average ratio of autoscale utilisation at or below which the load counts as steady (DX-013). Combined
     * with the average floor, a flat high series (little spikiness) is the autoscale→manual signal.
     */
    autoscaleToManualPeakToAvgRatio: number;
    /**
     * Account-total average-to-peak RU/s ratio below which ServerlessCandidate (DX-014) fires — a low, sporadic
     * workload with long idle stretches whose shape suits serverless pay-per-RU billing.
     */
    serverlessSporadicRatio: number;
    /**
     * RU/s: account-total peak above which ServerlessCandidate (DX-014) considers the workload real enough to
     * evaluate (below this the account is idle — that is DX-004's decommission case, not serverless).
     */
    serverlessPeakFloorRuPerSec: number;
    /**
     * RU/s: account-total peak at or below which ServerlessCandidate (DX-014) still fits serverless. Above this
     * single-partition ceiling the workload is steered away — a serverless container caps at 5,000 RU/s:
     * https://learn.microsoft.com/azure/cosmos-db/serverless-performance#request-unit-changes
     */
    serverlessPeakCeilingRuPerSec: number;
    // ─── Tier-2 (Log Analytics) thresholds ─────────────────────────────────────
    /** DX-002: minimum query executions in the window below which there is too little traffic to judge fan-out. */
    crossPartitionMinQueries: number;
    /** DX-002: a query shape whose average fan-out (distinct partitions per logical query) is at or above this counts as cross-partition. */
    crossPartitionFanoutThreshold: number;
    /** DX-002: share (%) of executions fanning out below which CrossPartitionQuery does not fire. */
    crossPartitionMedPct: number;
    /** DX-007: share (%) of executions fanning out at or above which the partition *key* is structurally misaligned (re-key), superseding DX-002. */
    shardKeyStructuralPct: number;
    /** DX-010: write-op RU share (%) at or above which the workload is write-dominant. */
    ingestionWriteRuPctFloor: number;
    /** DX-010: 429 rate (%) at or above which the container is throttling (paired with write-dominance to fire). */
    ingestionThrottleRatePct: number;
    /** DX-010: 429 rate (%) at or above which UncontrolledIngestion is High (else Medium). */
    ingestionHighPct: number;
    /** DX-010: minimum data-plane requests in the window below which there is too little traffic to judge. */
    ingestionMinRequests: number;
    /** DX-003: a collection with fewer requests than this is inactive for the window and ignored. */
    sharedThroughputMinRequests: number;
    /** DX-003: database-wide 429 rate (%) at or above which the shared pool is under pressure. */
    sharedThroughputPoolThrottlePct: number;
    /** DX-003: RU share (%) of the pool one collection must consume to count as the monopolizer. */
    sharedThroughputDominancePct: number;
    /** DX-003: 429 rate (%) at or above which a low-consumption sibling counts as a starved victim. */
    sharedThroughputVictimThrottlePct: number;
    /** DX-003: RU share (%) at or below which a throttled sibling counts as a starved victim (consuming little). */
    sharedThroughputVictimSharePct: number;
}

/**
 * Already-fetched per-container saturation picture the hot-partition (DX-006) and under-provisioning (DX-005)
 * rules consume. `maxP99`/`minP99` are the busiest/coolest physical partition p99 of `NormalizedRUConsumption`
 * over the window; `throttleRatePercent` is the container's aggregate 429 rate.
 */
export interface PartitionSaturationInput {
    resourceAgeDays?: number;
    databaseId: string;
    /** Absent for a shared database offer. */
    containerId?: string;
    /** Busiest physical partition's p99 utilization (% of provisioned). */
    maxP99: number;
    /** Coolest physical partition's p99 utilization (% of provisioned). */
    minP99: number;
    partitionCount: number;
    /** Container 429 rate (`sum(429)/sum(total)`, %). */
    throttleRatePercent: number;
    /** Total requests over the window; below the abstain gate the rate is too noisy to judge. */
    totalRequests: number;
    /** Throughput mode, so the under-provisioning remediation can say "raise the max" vs "raise RU/s". */
    throughputMode: ThroughputMode;
    /** Provisioned RU/s, quoted in the under-provisioning remediation when known. */
    provisionedRu?: number;
}

/** Duty-cycle thresholds for {@link evaluateAutoscaleCandidate}. */
export interface AutoscaleThresholds {
    /** Peak RU (%) the workload must reach — below this, right-size instead of autoscaling. */
    maxPercent: number;
    /** Average RU (%) the workload must stay at or below (mostly idle between bursts). */
    avgPercent: number;
    /** Peak-to-average ratio at or above which the burst is genuine. */
    peakToAvgRatio: number;
}

/** A physical partition's storage series (oldest → newest) for the growth/skew rules. */
export type StoragePartitionSeries = PartitionStorageSeries;

/** Per-container physical-partition storage series for the StorageGrowthRisk (and StorageSkewRisk) rules. */
export interface ContainerStorageInput {
    resourceAgeDays?: number;
    databaseId: string;
    containerId: string;
    partitions: readonly StoragePartitionSeries[];
}

/** Per-container storage inputs for the IndexingCostRisk rule. */
export interface IndexingUsageInput {
    databaseId: string;
    containerId: string;
    /** Latest `IndexUsage` bytes for the container, when reported. */
    indexUsageBytes?: number;
    /** Latest `DataUsage` bytes for the container, when reported. */
    dataUsageBytes?: number;
    /** Number of excluded paths other than the default root `_etag` exclusion. */
    userExcludedPathCount: number;
    indexingMode?: string;
}

/** Already-known ARM account configuration the config-only advisories (DX-016 / DX-008) read. */
export interface AccountConfigInput {
    /** Account name, for environment inference (DX-008). */
    accountName: string;
    /** Resource tags, for environment inference (DX-008). */
    tags?: Record<string, string | undefined>;
    /** Subscription display name, for environment inference (DX-008). */
    subscriptionName?: string;
    /** `defaultConsistencyLevel` from the ARM consistency policy (e.g. `Session`, `Strong`). */
    consistencyLevel?: string;
    /** Number of regions enabled for the account. */
    regionCount: number;
    /** `enableMultipleWriteLocations` from ARM. */
    multiRegionWritesEnabled: boolean;
    /** Number of write regions the account has. */
    writeRegionCount: number;
    /** Canonical API; undefined means unknown. */
    api: API | 'MongoDB' | undefined;
    backupPolicy?: BackupEligibilityInput;
    /** Unknown must not be interpreted as provisioned capacity or as a disabled feature. */
    isServerless?: boolean;
    perRegionPerPartitionAutoscaleEnabled?: boolean;
}

export interface BackupEligibilityInput {
    type?: string;
    continuousTier?: string;
    migrationState?: { status?: string; targetType?: string };
    fullFidelityChangeFeedEnabled?: boolean;
}

/** Already-fetched idle signal for one container over the 30-day window (DX-004). */
export interface IdleContainerInput {
    resourceAgeDays?: number;
    databaseId: string;
    /** Absent for a shared database offer; recovery belongs to the offer, not each member. */
    containerId?: string;
    /** Peak RU consumed in any bucket; successful empty reads become zero, unavailable reads remain undefined. */
    peakRuPerBucket?: number;
    /** Throughput billing mode; only manual (dedicated/shared) and autoscale offers are recoverable. */
    throughputMode: ThroughputMode;
    /** The container's configured provisioned RU/s (autoscale max for autoscale). */
    provisionedRu?: number;
}

/** Already-fetched partition-count + storage signal for one container (DX-009). */
export interface PartitionMergeInput {
    databaseId: string;
    containerId: string;
    /** Actual physical partition count (max of `PhysicalPartitionCount`). 0 ⇒ no reading. */
    actualPartitions: number;
    /** The container's configured provisioned RU/s (autoscale max or manual). */
    provisionedRu?: number;
    /** Peak data storage in bytes over the same six-hour window as the partition count. */
    dataUsageBytes?: number;
    backupPolicy?: BackupEligibilityInput;
}

/** Already-fetched autoscale duty-cycle signal for one container (DX-011 / DX-013). */
export interface AutoscaleUtilizationInput {
    resourceAgeDays?: number;
    databaseId: string;
    /** Absent for a shared database offer. */
    containerId?: string;
    /** Peak of the `AutoscaledRU`-as-%-of-configured-max series over the window (0..100). */
    peakPercent: number;
    /** Average of the same series (0..100), for the duty-cycle read. */
    avgPercent: number;
    /** Number of samples in the series (0 ⇒ no data). */
    sampleCount: number;
    /** The container's configured autoscale max RU/s. */
    configuredMaxRu?: number;
}

/** Already-computed account-total consumed-RU shape over the 30-day window (DX-014). */
export interface ServerlessCandidateInput {
    /** Account-total average consumed RU/s over the window. */
    avgRuPerSec: number;
    /** Account-total peak consumed RU/s over the window. */
    peakRuPerSec: number;
    /** Number of buckets sampled. */
    sampleCount: number;
    /** True when the account already uses serverless capacity mode (guard: never a candidate). */
    isServerless: boolean;
}

/** One manual offer's observed utilization; dedicated container or shared database, never a mode mixture. */
export interface ManualThroughputInput {
    databaseId: string;
    containerId?: string;
    ruPercents: readonly number[];
    peakPercent?: number;
    provisionedRu: number;
    resourceAgeDays?: number;
}

/** Serverless throttling uses request counts, not provisioned-capacity utilization. */
export interface ServerlessThrottlingInput {
    databaseId: string;
    containerId: string;
    totalRequests: number;
    throttleRatePercent: number;
}

/** Tunable cutoffs for {@link evaluateServerlessCandidate}. */
export interface ServerlessCandidateThresholds {
    /** Average-to-peak RU/s ratio below which the workload is sporadic enough for serverless. */
    sporadicRatio: number;
    /** Account-total peak (RU/s) above which the workload is real enough to evaluate serverless (else it is idle). */
    peakFloorRuPerSec: number;
    /** Account-total peak (RU/s) at or below which serverless still fits (single-partition ceiling). */
    peakCeilingRuPerSec: number;
}

/** One query shape (grouped by anonymized `QueryText`) and its fan-out over the window (CODA DX-002 `QueryShape`). */
export interface QueryShapeInput {
    /** Anonymized query text (identifiers → `p1`/`p2`, literals → `str1`), used only as display context. */
    text: string;
    /** Number of logical query executions of this shape. */
    executions: number;
    /** Average distinct physical partitions touched per execution (`avg(dcount(PartitionKeyRangeId))`). */
    avgFanout: number;
    /** Widest fan-out observed for this shape, the container's estimated physical-partition count. */
    maxFanout: number;
    /** Mean logical-query RU only when every execution/activity matched valid raw request charges. Not savings. */
    avgRu?: number;
}

/** Auditable request-log source and half-open absolute observation window. Not telemetry. */
export interface RequestLogEvidence {
    sourceTable: 'CDBDataPlaneRequests' | 'CDBDataPlaneRequests5M';
    sourceResolution: 'perRequest' | 'PT5M';
    observationStart: string;
    observationEnd: string;
}

export interface ConsistencyReadRuInput extends RequestLogEvidence {
    status: 'observed' | 'noObservations';
    readRequests: number;
    readRu: number;
}

/** Per-container cross-partition / shard-key input (DX-002 / DX-007). */
export interface CrossPartitionInput {
    databaseId: string;
    containerId: string;
    shapes: readonly QueryShapeInput[];
    /** Actual duration of the request-log observation; rates must not assume a fixed day. */
    evaluationWindowSeconds: number;
    observationStart?: string;
    observationEnd?: string;
}

export interface CrossPartitionThresholds {
    minQueries: number;
    fanoutThreshold: number;
    medPct: number;
}

export interface ShardKeyThresholds {
    structuralPct: number;
    minPartitions: number;
}

/** Per-container write-dominance + throttling input (CODA DX-010). RU/request totals over the window. */
export interface UncontrolledIngestionInput {
    databaseId: string;
    containerId: string;
    /** RU consumed by write operations (Create/Upsert/Replace/Delete/Patch/Batch/Execute). */
    writeRu: number;
    /** Total RU consumed across all operations. */
    totalRu: number;
    /** Total data-plane requests in the window. */
    totalRequests: number;
    /** Requests that returned 429. */
    throttledRequests: number;
    /** Peak ÷ average per-minute write RU — supporting burstiness evidence (surfaced, not a gate). */
    burstFactor: number;
    /** Dominant write-path client `UserAgent`, surfaced as context when present. */
    dominantUserAgent?: string;
    requestLogEvidence?: RequestLogEvidence;
}

export interface UncontrolledIngestionThresholds {
    writeRuPctFloor: number;
    throttleRatePct: number;
    highPct: number;
    minRequests: number;
}

/** One collection's data-plane traffic within a shared-throughput database, over the window (CODA DX-003). */
export interface CollectionTrafficInput {
    containerId: string;
    requests: number;
    throttledRequests: number;
    ruConsumed: number;
}

/** Per-shared-database input (CODA DX-003). */
export interface SharedThroughputInput {
    databaseId: string;
    /** Provisioned RU/s shared across the database's collections, surfaced as context. */
    sharedRu: number;
    collections: readonly CollectionTrafficInput[];
    /** Authoritative shared-offer membership. Unknown membership is insufficient evidence. */
    sharedContainerIds?: readonly string[];
    requestLogEvidence?: RequestLogEvidence;
}

export interface SharedThroughputThresholds {
    minRequests: number;
    poolThrottlePct: number;
    dominancePct: number;
    victimThrottlePct: number;
    victimSharePct: number;
}

/** Account-level Count TotalRequests over one common seven-day observation, not Log Analytics events. */
export interface AccountRequestMetricsInput {
    statusCounts: Readonly<Record<string, number>>;
    /** 429 counts split by OperationType; absent when unavailable, not an observed zero. */
    throttledOperationCounts?: Readonly<Record<string, number>>;
}

/** Already-fetched telemetry the derived-advisory engine consumes. */
export interface DerivedAdvisoryInputs {
    manualThroughput?: readonly ManualThroughputInput[];
    serverlessThrottling?: readonly ServerlessThrottlingInput[];
    /** Seven-day size series for skew, separate from the thirty-day growth observation. */
    storageSkew?: readonly ContainerStorageInput[];
    /** Legacy engine input; the collector supplies per-offer `manualThroughput` instead. */
    weeklyRuPercents: readonly number[];
    /** Max of `weeklyRuPercents`, or undefined when no 7-day data is available. */
    weeklyPeakPercent?: number;
    /** True when at least one container/database uses manual (non-autoscale, non-serverless) throughput. */
    hasManualThroughput: boolean;
    /** Total provisioned RU/s across manual-throughput containers, for over-provisioning materiality. */
    manualProvisionedRuTotal?: number;
    /** Per-container physical-partition p99 saturation + 429 rate for the hot-partition and under-provisioning rules. */
    partitions: readonly PartitionSaturationInput[];
    /** Per-container physical-partition storage series (30d) for growth; skew has its separate seven-day input. */
    storage: readonly ContainerStorageInput[];
    /** Per-container index/data storage for the indexing-cost rule. */
    indexing: readonly IndexingUsageInput[];
    /** Per-container idle signal (peak `TotalRequestUnits` per bucket over 30d) for the idle rule (DX-004). */
    idleContainers?: readonly IdleContainerInput[];
    /** Per-container physical-partition count + storage for the partition-merge rule (DX-009). */
    partitionMerges?: readonly PartitionMergeInput[];
    /** Per-autoscale-container `AutoscaledRU`-%-of-max duty cycle for the autoscale rules (DX-011 / DX-013). */
    autoscaleUtilizations?: readonly AutoscaleUtilizationInput[];
    /** Account-total consumed-RU shape (30d) for the serverless-candidate rule (DX-014); absent when unavailable. */
    serverless?: ServerlessCandidateInput;
    /** Total provisioned RU/s across the account, the materiality denominator for the idle/autoscale-max rules. */
    scopeProvisionedRuTotal?: number;
    /** Complete positive all-manual offer inventory only; autoscale/unknown inventory cannot quantify regions. */
    manualRegionalCapacityRu?: number;
    /** Account-level ARM configuration for the config-only advisories (DX-016 / DX-008); absent when unavailable. */
    accountConfig?: AccountConfigInput;
    /** Optional observed read charge; never gates the configuration-only consistency finding. */
    consistencyReadRu?: ConsistencyReadRuInput;
    /** Per-container query fan-out shapes (Log Analytics) for the cross-partition + shard-key rules (DX-002 / DX-007). */
    crossPartition?: readonly CrossPartitionInput[];
    /** Per-container write-dominance + throttling (Log Analytics) for the uncontrolled-ingestion rule (DX-010). */
    ingestion?: readonly UncontrolledIngestionInput[];
    /** Per-shared-database collection traffic (Log Analytics) for the shared-throughput-starvation rule (DX-003). */
    sharedThroughput?: readonly SharedThroughputInput[];
    accountRequests?: AccountRequestMetricsInput;
}
