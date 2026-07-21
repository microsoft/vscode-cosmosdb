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
    getPartitionStorageSeries,
    type PartitionStorageResult,
    type PartitionStorageSample,
    type PartitionStorageSeries,
    type PartitionThresholds,
} from './partitionHealth';
import { getRuTrends, getThrottleRate } from './ruTrends';
import {
    containerKey,
    DEFAULT_PARTITION_HEADROOM_PCT,
    DEFAULT_PARTITION_SATURATION_PCT,
    DEFAULT_THROTTLE_RATE_PCT,
    percentile,
    type UnavailableReason,
} from './shared';

// ─── Client-side derived advisories ──────────────────────────────────────────────
//
// Unlike Azure Alerts + Advisor recommendations, these advisories are derived on
// the extension host from telemetry the dashboard has already fetched (RU trends,
// inventory metrics, partition health). No new ARM endpoints. The portal does not
// derive these on its Overview blade, so thresholds are advisory and user-tunable
// via `cosmosDB.accountOverview.advisories.*`. Every rule function is pure so it
// can be unit-tested against synthetic inputs; `collectDerivedAdvisories` does the
// fetching and calls `computeDerivedAdvisories`.

/** The derived-advisory rules this engine implements (P0 + best-effort). */
export type DerivedAdvisoryRule =
    | 'HotPartitionRisk'
    | 'SustainedThrottlingInRegion'
    | 'OverProvisioning'
    | 'AutoscaleCandidate'
    | 'StorageGrowthRisk'
    | 'StorageSkewRisk'
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
    /** 7-day p99 RU (%) below which OverProvisioning fires (CODA DX-001 moderate band). */
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
}

export const DEFAULT_ADVISORY_THRESHOLDS: DerivedAdvisoryThresholds = {
    partitionSaturationPercent: DEFAULT_PARTITION_SATURATION_PCT,
    partitionHeadroomPercent: DEFAULT_PARTITION_HEADROOM_PCT,
    throttleRatePercent: DEFAULT_THROTTLE_RATE_PCT,
    overProvisioningBandPercent: 30,
    autoscaleMaxPercent: 40,
    autoscaleAvgPercent: 30,
    autoscalePeakToAvgRatio: 5,
    storageGrowthHorizonDays: 180,
    storageSkewBalanceRatio: 0.7,
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

/** Arithmetic mean of the finite values in a series; 0 for an empty series. Pure. */
export function mean(values: readonly number[]): number {
    const clean = values.filter((v) => Number.isFinite(v));
    if (clean.length === 0) {
        return 0;
    }
    return clean.reduce((sum, v) => sum + v, 0) / clean.length;
}

/**
 * Already-fetched per-container saturation picture the hot-partition (DX-006) and under-provisioning (DX-005)
 * rules consume. `maxP99`/`minP99` are the busiest/coolest physical partition p99 of `NormalizedRUConsumption`
 * over the window; `throttleRatePercent` is the container's aggregate 429 rate.
 */
export interface PartitionSaturationInput {
    databaseId: string;
    containerId: string;
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

/**
 * HotPartitionRisk (DX-006): the busiest physical partition is **saturated** (p99 at or above the saturation
 * threshold) while at least one other partition still has **headroom** (p99 below the headroom threshold). Unlike a
 * raw share or fair-share cutoff, this keys off "is some partition pinned at capacity while another is cool" — the
 * signal that the partition key, not more RU/s, is the fix. A single partition, or uniform saturation (every
 * partition busy → global under-provisioning, DX-005), never fires here. Severity scales with actual impact: active
 * throttling (429 rate at or above the threshold) → High, saturated-but-not-throttling → Medium. Pure.
 */
export function evaluateHotPartitionRisk(
    input: PartitionSaturationInput,
    saturationPercent: number,
    headroomPercent: number,
    throttleThresholdPercent: number,
): DerivedAdvisory | undefined {
    if (input.partitionCount < 2 || input.maxP99 < saturationPercent || input.minP99 >= headroomPercent) {
        return undefined;
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const busiest = Math.round(input.maxP99);
    const coolest = Math.round(input.minP99);
    const saturation = Math.round(saturationPercent);
    const headroom = Math.round(headroomPercent);
    const throttling = input.throttleRatePercent >= throttleThresholdPercent;
    const severity: DerivedAdvisorySeverity = throttling ? 'High' : 'Medium';

    const impact = throttling
        ? l10n.t('The container is already throttling (HTTP 429), so the hot partition is capping real traffic.')
        : l10n.t(
              'It is not throttling yet, but the pinned partition cannot borrow the cooler partitions’ capacity as load grows.',
          );

    return {
        id: `HotPartitionRisk:${scope}`,
        rule: 'HotPartitionRisk',
        severity,
        title: l10n.t('Hot physical partition in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'In "{container}", the busiest of {count} physical partitions ran at {busiest}% p99 utilization (at or above the {saturation}% saturation mark) while the coolest sat at {coolest}% (below the {headroom}% headroom mark). Load is concentrated by the partition key, not a global shortfall. ',
                { container: input.containerId, count: input.partitionCount, busiest, saturation, coolest, headroom },
            ) + impact,
        ),
        suggestedAction: l10n.t(
            'Redesign the partition key for higher cardinality (avoid hotspots; consider synthetic or hierarchical keys) so traffic spreads across partitions — adding RU/s will not fix a single hot partition.',
        ),
        thresholdReference: l10n.t('Threshold: busiest partition p99 ≥ {saturation}% while another < {headroom}%', {
            saturation,
            headroom,
        }),
        scope,
    };
}

/** Container 429 rate (%) at or above which under-provisioning severity is High. */
const UNDER_PROVISIONING_HIGH_RATE_PCT = 20;
/** Container 429 rate (%) at or above which under-provisioning severity is Medium (below this, Low). */
const UNDER_PROVISIONING_MEDIUM_RATE_PCT = 5;
/** Below this request count the 429 rate is too noisy to judge, so the rule abstains. */
const UNDER_PROVISIONING_MIN_REQUESTS = 1_000;

/**
 * SustainedThrottlingInRegion / genuine under-provisioning (DX-005): a container is sustaining 429 throttling
 * (rate at or above the threshold) **and** at least one partition is saturated, **and** the saturation is
 * *uniform* — every partition is busy (coolest p99 at or above the headroom mark). Uniform saturation means the
 * workload simply needs more capacity; the non-uniform (skew) case is left to HotPartitionRisk (DX-006) so the two
 * never double-report the same throttling. A `min-requests` gate abstains on traffic too low to judge. Severity
 * grades by the 429 rate. Pure.
 */
export function evaluateUnderProvisioning(
    input: PartitionSaturationInput,
    saturationPercent: number,
    headroomPercent: number,
    throttleThresholdPercent: number,
): DerivedAdvisory | undefined {
    if (input.totalRequests < UNDER_PROVISIONING_MIN_REQUESTS) {
        return undefined;
    }
    const throttling = input.throttleRatePercent >= throttleThresholdPercent;
    const atCapacity = input.maxP99 >= saturationPercent;
    const uniform = input.minP99 >= headroomPercent;
    if (!throttling || !atCapacity || !uniform) {
        return undefined;
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const rate = Math.round(input.throttleRatePercent * 10) / 10;
    const busiest = Math.round(input.maxP99);
    const coolest = Math.round(input.minP99);
    const severity: DerivedAdvisorySeverity =
        input.throttleRatePercent >= UNDER_PROVISIONING_HIGH_RATE_PCT
            ? 'High'
            : input.throttleRatePercent >= UNDER_PROVISIONING_MEDIUM_RATE_PCT
              ? 'Medium'
              : 'Low';

    const action =
        input.throughputMode === 'autoscale'
            ? input.provisionedRu !== undefined
                ? l10n.t('Raise the autoscale maximum above {ru} RU/s — it is pinned at the ceiling.', {
                      ru: Math.round(input.provisionedRu).toLocaleString(),
                  })
                : l10n.t('Raise the autoscale maximum — it is pinned at the ceiling.')
            : input.provisionedRu !== undefined
              ? l10n.t('Raise provisioned throughput above {ru} RU/s, or convert to autoscale.', {
                    ru: Math.round(input.provisionedRu).toLocaleString(),
                })
              : l10n.t('Raise provisioned throughput, or convert to autoscale.');

    return {
        id: `SustainedThrottlingInRegion:${scope}`,
        rule: 'SustainedThrottlingInRegion',
        severity,
        title: l10n.t('Sustained throttling in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'In "{container}", {rate}% of requests were throttled (HTTP 429) while every physical partition was saturated (busiest p99 {busiest}%, coolest {coolest}%). Because all partitions are at capacity — not just one — this is a genuine capacity shortfall rather than a hot partition.',
                { container: input.containerId, rate, busiest, coolest },
            ),
        ),
        suggestedAction: action,
        thresholdReference: l10n.t('Threshold: 429 rate ≥ {rate}% with every partition p99 ≥ {saturation}%', {
            rate: Math.round(throttleThresholdPercent),
            saturation: Math.round(saturationPercent),
        }),
        scope,
    };
}

/** Do not flag over-provisioning when the busiest sample reached this % — a recurring batch needs peak capacity. */
const OVERPROVISIONING_PEAK_GUARD_PCT = 90;
/** Headroom multiplier applied to observed p99 demand when sizing the right-size target (CODA DX-001). */
const OVERPROVISIONING_HEADROOM = 1.3;
/** Platform minimum RU/s floor a right-size recommendation never drops below. */
const OVERPROVISIONING_MIN_RU = 400;
/** Wasted RU/s as % of scope provisioned RU/s at or above which severity is High. */
const OVERPROVISIONING_MATERIAL_HIGH_PCT = 5;
/** Wasted RU/s as % of scope provisioned RU/s at or above which severity is Medium (below this, Low). */
const OVERPROVISIONING_MATERIAL_MEDIUM_PCT = 1;

/**
 * OverProvisioning (CODA DX-001): sustained low **p99** RU on manual throughput over the trailing 7 days, banded
 * below the moderate threshold. Two guards keep it from firing on workloads that genuinely need their capacity: the
 * p99 band ignores brief spikes, and a **peak-saturation guard** suppresses the finding when the busiest sample
 * saturated capacity (a recurring batch needs that peak). Severity is **relative materiality** — wasted RU/s as a
 * share of the scope's provisioned RU/s (the same waste is material against a small account but trivial against a
 * fleet) — falling back to absolute wasted RU/s when the scope total is unknown. The right-size target covers p99
 * demand plus headroom and never drops below the observed peak, so it can never throttle a real spike. Pure.
 */
export function evaluateOverProvisioning(
    p99Percent: number | undefined,
    peakPercent: number | undefined,
    thresholdPercent: number,
    hasManualThroughput: boolean,
    provisionedRuTotal?: number,
): DerivedAdvisory | undefined {
    if (!hasManualThroughput || p99Percent === undefined || p99Percent >= thresholdPercent) {
        return undefined;
    }
    // Peak-saturation guard: a workload whose busiest sample saturates capacity genuinely needs it at peak.
    if (peakPercent !== undefined && peakPercent >= OVERPROVISIONING_PEAK_GUARD_PCT) {
        return undefined;
    }
    const p99 = Math.round(p99Percent);
    const threshold = Math.round(thresholdPercent);

    let wastedRu: number | undefined;
    let severity: DerivedAdvisorySeverity = 'Medium';
    if (provisionedRuTotal !== undefined && provisionedRuTotal > 0) {
        const consumedAtP99 = (p99Percent / 100) * provisionedRuTotal;
        const peakConsumed = ((peakPercent ?? p99Percent) / 100) * provisionedRuTotal;
        const recommended = Math.min(
            provisionedRuTotal,
            Math.max(
                OVERPROVISIONING_MIN_RU,
                Math.ceil(consumedAtP99 * OVERPROVISIONING_HEADROOM),
                Math.ceil(peakConsumed),
            ),
        );
        wastedRu = Math.max(0, Math.round(provisionedRuTotal - recommended));
        const materialityPct = (wastedRu / provisionedRuTotal) * 100;
        severity =
            materialityPct >= OVERPROVISIONING_MATERIAL_HIGH_PCT
                ? 'High'
                : materialityPct >= OVERPROVISIONING_MATERIAL_MEDIUM_PCT
                  ? 'Medium'
                  : 'Low';
    }

    const materiality =
        wastedRu !== undefined
            ? l10n.t(' That is roughly {wasted} RU/s of provisioned capacity the workload never uses.', {
                  wasted: wastedRu.toLocaleString(),
              })
            : '';

    return {
        id: 'OverProvisioning',
        rule: 'OverProvisioning',
        severity,
        title: l10n.t('Throughput may be over-provisioned'),
        rationale: clampRationale(
            l10n.t(
                '99th-percentile normalized RU consumption stayed at {p99}% over the last 7 days, below the {threshold}% over-provisioning threshold, while at least one container uses manual throughput. Banding on p99 rather than the peak ignores brief spikes that do not reflect steady demand.',
                { p99, threshold },
            ) + materiality,
        ),
        suggestedAction: l10n.t(
            'Lower provisioned RU/s to match observed demand, or switch to autoscale so capacity tracks usage automatically.',
        ),
        thresholdReference: l10n.t('Threshold: 7-day p99 < {threshold}% RU', { threshold }),
    };
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

/**
 * AutoscaleCandidate (best-effort): a manual container whose 7-day RU profile is
 * a genuine burst — a real peak (`max ≥ maxPercent`) on a mostly-idle baseline
 * (`avg ≤ avgPercent`) with a large peak-to-average ratio (`≥ peakToAvgRatio`).
 * This is the duty cycle (average as a fraction of peak) that autoscale
 * economics turn on, not dispersion around the mean — a workload oscillating
 * 40↔60% has high variance yet a high duty cycle, so autoscale would cost more.
 * Pure.
 */
export function evaluateAutoscaleCandidate(
    maxPercent: number | undefined,
    avgPercent: number | undefined,
    thresholds: AutoscaleThresholds,
    hasManualThroughput: boolean,
): DerivedAdvisory | undefined {
    if (!hasManualThroughput || maxPercent === undefined || avgPercent === undefined || avgPercent <= 0) {
        return undefined;
    }
    const peakToAvg = maxPercent / avgPercent;
    if (
        maxPercent < thresholds.maxPercent ||
        avgPercent > thresholds.avgPercent ||
        peakToAvg < thresholds.peakToAvgRatio
    ) {
        return undefined;
    }
    const max = Math.round(maxPercent);
    const avg = Math.round(avgPercent);
    const ratio = Math.round(peakToAvg * 10) / 10;
    return {
        id: 'AutoscaleCandidate',
        rule: 'AutoscaleCandidate',
        severity: 'Medium',
        title: l10n.t('Workload looks like an autoscale candidate'),
        rationale: clampRationale(
            l10n.t(
                'Over the last 7 days RU consumption peaked at {max}% but averaged just {avg}% — a {ratio}× peak-to-average burst on a mostly-idle baseline, while at least one container uses manual throughput. A tall peak over a low average is exactly the duty cycle where autoscale tracks demand more cheaply than fixed throughput sized for the peak.',
                { max, avg, ratio },
            ),
        ),
        suggestedAction: l10n.t(
            'Enable autoscale on the bursty containers so provisioned RU/s follows demand between the configured floor and ceiling.',
        ),
        thresholdReference: l10n.t('Threshold: peak ≥ {max}%, average ≤ {avg}%, and peak/average ≥ {ratio}×', {
            max: thresholds.maxPercent,
            avg: thresholds.avgPercent,
            ratio: thresholds.peakToAvgRatio,
        }),
    };
}

const GIB = 1024 ** 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Physical-partition storage split ceiling (50 GiB). Structural constant — the wall StorageGrowthRisk projects to. */
const PARTITION_STORAGE_LIMIT_BYTES = 50 * GIB;
/** Below this current size a partition is immaterial and ignored (a tiny partition near the wall is not a concern). */
const STORAGE_GROWTH_MIN_MATERIAL_BYTES = 1 * GIB;
/** Below this slope the growth is noise, not a trend — avoids projecting a wall from flat/jittery series. */
const STORAGE_GROWTH_MIN_SLOPE_BYTES_PER_DAY = 0.1 * GIB;
/** Days-to-limit at or below which StorageGrowthRisk ranks High. */
const STORAGE_GROWTH_HIGH_DAYS = 30;
/** Days-to-limit at or below which StorageGrowthRisk ranks Medium (above it, up to the horizon, Low). */
const STORAGE_GROWTH_MEDIUM_DAYS = 90;

/** Below this busiest-partition size, storage skew is immaterial (a balanced-but-tiny split is not a concern). */
const STORAGE_SKEW_MIN_BUSIEST_BYTES = 1 * GIB;
/** Busiest-partition size (≥ 80% of the 50 GiB ceiling) at or above which StorageSkewRisk ranks High. */
const STORAGE_SKEW_HIGH_BYTES = 40 * GIB;
/** Busiest-partition size (≥ 50% of the 50 GiB ceiling) at or above which StorageSkewRisk ranks Medium. */
const STORAGE_SKEW_MEDIUM_BYTES = 25 * GIB;

/** A physical partition's storage series (oldest → newest) for the growth/skew rules. */
export type StoragePartitionSeries = PartitionStorageSeries;

/** Per-container physical-partition storage series for the StorageGrowthRisk (and StorageSkewRisk) rules. */
export interface ContainerStorageInput {
    databaseId: string;
    containerId: string;
    partitions: readonly StoragePartitionSeries[];
}

/** Latest (newest-timestamp) size in bytes of a partition's series, or undefined when it has no samples. Pure. */
function latestBytes(series: StoragePartitionSeries): number | undefined {
    let latest: { timestamp: number; bytes: number } | undefined;
    for (const sample of series.samples) {
        if (!Number.isFinite(sample.bytes) || !Number.isFinite(sample.timestamp)) {
            continue;
        }
        if (latest === undefined || sample.timestamp >= latest.timestamp) {
            latest = sample;
        }
    }
    return latest?.bytes;
}

/**
 * Least-squares slope of a partition's storage series in bytes/day. Returns
 * `undefined` when there are fewer than two datapoints at distinct times (no
 * trend can be fit). Fitting a trajectory — rather than a raw last-minus-first
 * delta — is robust to a single noisy endpoint. Pure.
 */
export function storageGrowthSlopeBytesPerDay(samples: readonly PartitionStorageSample[]): number | undefined {
    const clean = samples.filter((s) => Number.isFinite(s.timestamp) && Number.isFinite(s.bytes));
    if (clean.length < 2) {
        return undefined;
    }
    const xsDays = clean.map((s) => s.timestamp / MS_PER_DAY);
    const ys = clean.map((s) => s.bytes);
    const meanX = mean(xsDays);
    const meanY = mean(ys);
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < clean.length; i++) {
        const dx = xsDays[i] - meanX;
        numerator += dx * (ys[i] - meanY);
        denominator += dx * dx;
    }
    if (denominator === 0) {
        return undefined;
    }
    return numerator / denominator;
}

/**
 * Projected days for a partition at `currentBytes` growing at `slopeBytesPerDay`
 * to reach `limitBytes`. Returns 0 if it is already at/over the limit, and
 * `undefined` for a flat or shrinking trajectory (it never reaches the wall).
 * Pure.
 */
export function daysToStorageLimit(
    currentBytes: number,
    slopeBytesPerDay: number,
    limitBytes: number,
): number | undefined {
    if (!Number.isFinite(slopeBytesPerDay) || slopeBytesPerDay <= 0) {
        return undefined;
    }
    if (currentBytes >= limitBytes) {
        return 0;
    }
    return (limitBytes - currentBytes) / slopeBytesPerDay;
}

/**
 * StorageGrowthRisk (best-effort): the soonest-to-fill physical partition in a
 * container is on a least-squares trajectory to the 50 GiB split ceiling within
 * the configured horizon. Unlike an absolute bytes-added trigger, this answers
 * "how soon do you hit the wall" — a 2 TB container adding 10 GiB/week spread over
 * dozens of partitions is decades away and does not fire, while a 40 GiB partition
 * growing steadily does. Immaterial (< 1 GiB) and flat/noisy (< 0.1 GiB/day)
 * partitions are ignored. Severity grades by horizon. Pure.
 */
export function evaluateStorageGrowthRisk(
    input: ContainerStorageInput,
    horizonDays: number,
): DerivedAdvisory | undefined {
    if (horizonDays <= 0) {
        return undefined;
    }
    let soonest: { days: number; currentBytes: number; slopeBytesPerDay: number } | undefined;
    for (const partition of input.partitions) {
        const currentBytes = latestBytes(partition);
        if (currentBytes === undefined || currentBytes < STORAGE_GROWTH_MIN_MATERIAL_BYTES) {
            continue;
        }
        const slopeBytesPerDay = storageGrowthSlopeBytesPerDay(partition.samples);
        if (slopeBytesPerDay === undefined || slopeBytesPerDay < STORAGE_GROWTH_MIN_SLOPE_BYTES_PER_DAY) {
            continue;
        }
        const days = daysToStorageLimit(currentBytes, slopeBytesPerDay, PARTITION_STORAGE_LIMIT_BYTES);
        if (days === undefined) {
            continue;
        }
        if (soonest === undefined || days < soonest.days) {
            soonest = { days, currentBytes, slopeBytesPerDay };
        }
    }
    if (soonest === undefined || soonest.days > horizonDays) {
        return undefined;
    }

    const severity: DerivedAdvisorySeverity =
        soonest.days <= STORAGE_GROWTH_HIGH_DAYS
            ? 'High'
            : soonest.days <= STORAGE_GROWTH_MEDIUM_DAYS
              ? 'Medium'
              : 'Low';
    const scope = containerKey(input.databaseId, input.containerId);
    const days = Math.max(0, Math.round(soonest.days));
    const currentGiB = Math.round((soonest.currentBytes / GIB) * 10) / 10;
    const perDayGiB = Math.round((soonest.slopeBytesPerDay / GIB) * 100) / 100;
    const horizon = Math.round(horizonDays);
    return {
        id: `StorageGrowthRisk:${scope}`,
        rule: 'StorageGrowthRisk',
        severity,
        title: l10n.t('Physical partition approaching its storage limit in {container}', {
            container: input.containerId,
        }),
        rationale: clampRationale(
            l10n.t(
                'The fastest-growing physical partition in "{container}" is at {current} GiB and growing about {perDay} GiB/day — on that trajectory it reaches the 50 GiB physical-partition split ceiling in roughly {days} days, within the {horizon}-day risk horizon. A partition that hits the wall can throttle or block writes until it splits.',
                { container: input.containerId, current: currentGiB, perDay: perDayGiB, days, horizon },
            ),
        ),
        suggestedAction: l10n.t(
            'Confirm the partition key spreads new data across partitions, archive or delete cold data, and ensure large logical keys stay well under the 20 GiB per-key cap so partitions split cleanly.',
        ),
        thresholdReference: l10n.t('Threshold: projected < {horizon} days to the 50 GiB partition ceiling', {
            horizon,
        }),
        scope,
    };
}

/**
 * Balance ratio (`min ÷ max`) of a set of physical-partition sizes: 1.0 is
 * perfectly balanced, values near 0 mean one partition dwarfs its siblings.
 * Returns `undefined` for fewer than two sizes or a non-positive max (nothing to
 * compare). Pure.
 */
export function balanceRatio(sizesBytes: readonly number[]): number | undefined {
    const clean = sizesBytes.filter((v) => Number.isFinite(v) && v >= 0);
    if (clean.length < 2) {
        return undefined;
    }
    const max = Math.max(...clean);
    const min = Math.min(...clean);
    if (max <= 0) {
        return undefined;
    }
    return min / max;
}

/**
 * StorageSkewRisk (best-effort): physical-partition sizes are imbalanced
 * (`min/max` below the configured balance ratio) *and* the busiest partition is
 * material (≥ 1 GiB). Unlike a raw storage-share cutoff — which is
 * partition-count-dependent and size-blind (a balanced 40 MiB/60 MiB two-way
 * split trips a 35% share) — the balance ratio only fires on genuine imbalance,
 * and severity grades by the busiest partition's proximity to the 50 GiB split
 * ceiling (≥ 80% → High, ≥ 50% → Medium). Balanced-but-large partitions are
 * healthy: they simply split as they grow. Pure.
 */
export function evaluateStorageSkewRisk(
    input: ContainerStorageInput,
    balanceThreshold: number,
): DerivedAdvisory | undefined {
    if (balanceThreshold <= 0) {
        return undefined;
    }
    const sizes = input.partitions
        .map((partition) => latestBytes(partition))
        .filter((bytes): bytes is number => bytes !== undefined);
    const ratio = balanceRatio(sizes);
    if (ratio === undefined || ratio >= balanceThreshold) {
        return undefined;
    }
    const busiestBytes = Math.max(...sizes);
    if (busiestBytes < STORAGE_SKEW_MIN_BUSIEST_BYTES) {
        return undefined;
    }

    const severity: DerivedAdvisorySeverity =
        busiestBytes >= STORAGE_SKEW_HIGH_BYTES ? 'High' : busiestBytes >= STORAGE_SKEW_MEDIUM_BYTES ? 'Medium' : 'Low';
    const scope = containerKey(input.databaseId, input.containerId);
    const busiestGiB = Math.round((busiestBytes / GIB) * 10) / 10;
    const balance = Math.round(ratio * 100) / 100;
    const threshold = Math.round(balanceThreshold * 100) / 100;
    const ceilingPercent = Math.round((busiestBytes / PARTITION_STORAGE_LIMIT_BYTES) * 100);
    return {
        id: `StorageSkewRisk:${scope}`,
        rule: 'StorageSkewRisk',
        severity,
        title: l10n.t('Uneven physical-partition storage in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'Physical-partition storage in "{container}" is uneven — the coolest partition holds only {balance}× the busiest (below the {threshold}× balance floor), and the busiest is at {busiest} GiB, about {ceiling}% of the 50 GiB split ceiling. A single oversized partition hits the split wall long before its balanced siblings, capping the container.',
                { container: input.containerId, balance, threshold, busiest: busiestGiB, ceiling: ceilingPercent },
            ),
        ),
        suggestedAction: l10n.t(
            'Review the partition key for a higher-cardinality choice so data spreads evenly, and split or archive the oversized logical keys concentrating storage on one partition.',
        ),
        thresholdReference: l10n.t('Threshold: min/max partition size < {threshold}× with busiest ≥ 1 GiB', {
            threshold,
        }),
        scope,
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
    /** Account-wide 7-day RU% samples for the over-provisioning + autoscale rules. */
    weeklyRuPercents: readonly number[];
    /** Max of `weeklyRuPercents`, or undefined when no 7-day data is available. */
    weeklyPeakPercent?: number;
    /** True when at least one container/database uses manual (non-autoscale, non-serverless) throughput. */
    hasManualThroughput: boolean;
    /** Total provisioned RU/s across manual-throughput containers, for over-provisioning materiality. */
    manualProvisionedRuTotal?: number;
    /** Per-container physical-partition p99 saturation + 429 rate for the hot-partition and under-provisioning rules. */
    partitions: readonly PartitionSaturationInput[];
    /** Per-container physical-partition storage series (7d) for the storage-growth and storage-skew rules. */
    storage: readonly ContainerStorageInput[];
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
        const hot = evaluateHotPartitionRisk(
            partition,
            thresholds.partitionSaturationPercent,
            thresholds.partitionHeadroomPercent,
            thresholds.throttleRatePercent,
        );
        if (hot) {
            advisories.push(hot);
        }
        // DX-005 only fires on uniform saturation; the skew case is already covered by HotPartitionRisk above,
        // so the two never double-report the same throttling.
        const under = evaluateUnderProvisioning(
            partition,
            thresholds.partitionSaturationPercent,
            thresholds.partitionHeadroomPercent,
            thresholds.throttleRatePercent,
        );
        if (under) {
            advisories.push(under);
        }
    }

    const overProvisioning = evaluateOverProvisioning(
        percentile(inputs.weeklyRuPercents, 99),
        inputs.weeklyPeakPercent ??
            (inputs.weeklyRuPercents.length > 0 ? Math.max(...inputs.weeklyRuPercents) : undefined),
        thresholds.overProvisioningBandPercent,
        inputs.hasManualThroughput,
        inputs.manualProvisionedRuTotal,
    );
    if (overProvisioning) {
        advisories.push(overProvisioning);
    }

    const autoscale = evaluateAutoscaleCandidate(
        inputs.weeklyPeakPercent ??
            (inputs.weeklyRuPercents.length > 0 ? Math.max(...inputs.weeklyRuPercents) : undefined),
        inputs.weeklyRuPercents.length > 0 ? mean(inputs.weeklyRuPercents) : undefined,
        {
            maxPercent: thresholds.autoscaleMaxPercent,
            avgPercent: thresholds.autoscaleAvgPercent,
            peakToAvgRatio: thresholds.autoscalePeakToAvgRatio,
        },
        inputs.hasManualThroughput,
    );
    if (autoscale) {
        advisories.push(autoscale);
    }

    for (const storage of inputs.storage) {
        const growth = evaluateStorageGrowthRisk(storage, thresholds.storageGrowthHorizonDays);
        if (growth) {
            advisories.push(growth);
        }
        const skew = evaluateStorageSkewRisk(storage, thresholds.storageSkewBalanceRatio);
        if (skew) {
            advisories.push(skew);
        }
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

    const [weekTrends, inventoryMetrics] = await Promise.all([
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

    return computeDerivedAdvisories(
        {
            weeklyRuPercents,
            weeklyPeakPercent: weekTrends.peakPercent,
            hasManualThroughput: rows.some((row) => MANUAL_THROUGHPUT_MODES.has(row.throughputMode)),
            manualProvisionedRuTotal,
            partitions,
            storage,
            indexing,
        },
        advisoryThresholds,
    );
}
