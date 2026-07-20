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
    type PartitionHealthResult,
    type PartitionStorageResult,
    type PartitionStorageSample,
    type PartitionStorageSeries,
    type PartitionThresholds,
} from './partitionHealth';
import { getRuTrends, type RuTrendPoint } from './ruTrends';
import { containerKey, type UnavailableReason } from './shared';

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
     * Fair-share multiple (busiest partition's RU share ÷ its even-split baseline `1/partitionCount`) at or above
     * which HotPartitionRisk fires. Partition-count-independent: 1.0 is a perfectly balanced container, so a value
     * of 3 flags a partition pulling three times its fair share regardless of how many partitions exist.
     */
    hotPartitionFairShareMultiple: number;
    /** Share of throttled buckets (%) over the window at or above which SustainedThrottlingInRegion fires. */
    throttledBucketSharePercent: number;
    /** 7-day peak RU (%) below which OverProvisioning fires. */
    overProvisioningPeakPercent: number;
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
    hotPartitionFairShareMultiple: 3,
    throttledBucketSharePercent: 5,
    overProvisioningPeakPercent: 25,
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

/**
 * Share (0..1) of buckets that qualify as throttled over the window. Unlike the
 * longest *continuous* run, this counts intermittent throttling too: a
 * 20-min-on / 10-min-off pattern all day never accumulates a long continuous run
 * yet has a high throttled share. Returns 0 for an empty series. Pure.
 */
export function throttledBucketShare(points: readonly RuTrendPoint[]): number {
    if (points.length === 0) {
        return 0;
    }
    const throttled = points.reduce((count, point) => count + (point.throttled ? 1 : 0), 0);
    return throttled / points.length;
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
 * Linear-interpolated percentile (`p` in 0..100) of the finite values in a
 * series; `undefined` for an empty series. Used to band over-provisioning on a
 * spike-resistant p99 rather than the raw max, so a single-minute peak cannot
 * suppress the finding. Pure.
 */
export function percentile(values: readonly number[], p: number): number | undefined {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return undefined;
    }
    if (sorted.length === 1) {
        return sorted[0];
    }
    const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    if (low === high) {
        return sorted[low];
    }
    return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
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
 * SustainedThrottlingInRegion / UnderProvisioning (P0): a material share of
 * buckets over the last 24h qualified as throttled (HTTP 429). Keying on the
 * *share* of throttled buckets rather than the longest *continuous* run catches
 * chronic intermittent throttling (an on/off pattern that never accumulates a
 * long unbroken run). The remediation copy is split by root cause: when a hot
 * partition is also flagged the fix is to re-key (CODA DX-006), otherwise to add
 * RU/s (CODA DX-005) — adding capacity does not fix a hot partition. Pure.
 */
export function evaluateSustainedThrottling(
    throttledShare: number,
    fireSharePercent: number,
    hotPartitionPresent: boolean,
): DerivedAdvisory | undefined {
    const sharePercent = throttledShare * 100;
    if (fireSharePercent <= 0 || sharePercent < fireSharePercent) {
        return undefined;
    }
    const share = Math.round(sharePercent);
    const threshold = Math.round(fireSharePercent);
    const severity: DerivedAdvisorySeverity = sharePercent >= 10 ? 'High' : 'Medium';

    const rootCause = hotPartitionPresent
        ? l10n.t(
              'A hot partition is also flagged on this account, so the throttling is likely concentrated on one partition rather than a global capacity shortfall — adding RU/s would not help.',
          )
        : l10n.t(
              'With no hot partition flagged, the throttling most likely means the workload is under-provisioned for its peak.',
          );
    const action = hotPartitionPresent
        ? l10n.t(
              'Re-key the hot container to spread traffic across partitions (adding RU/s will not fix a single hot partition), and smooth bursts with client-side retries and batching.',
          )
        : l10n.t(
              'Increase provisioned throughput (or enable autoscale) to cover the peak, and smooth bursts with client-side retries and batching.',
          );

    return {
        id: 'SustainedThrottlingInRegion',
        rule: 'SustainedThrottlingInRegion',
        severity,
        title: l10n.t('Sustained throttling detected'),
        rationale: clampRationale(
            l10n.t(
                'Requests were throttled (HTTP 429) in {share}% of monitored intervals over the last 24 hours, at or above the {threshold}% throttled-share threshold. ',
                { share, threshold },
            ) + rootCause,
        ),
        suggestedAction: action,
        thresholdReference: l10n.t('Threshold: ≥ {threshold}% of 24h intervals throttled', { threshold }),
    };
}

/** Estimated wasted RU/s (High) at or above which over-provisioning is material enough to rank High. */
const OVERPROVISIONING_HIGH_WASTED_RU = 10_000;
/** Estimated wasted RU/s at or above which over-provisioning ranks Medium (below this, Low). */
const OVERPROVISIONING_MEDIUM_WASTED_RU = 1_000;

/**
 * OverProvisioning (best-effort): sustained low **p99** RU on manual throughput
 * over the trailing 7 days. Banding on p99 (rather than the raw max) is
 * spike-resistant — a single-minute peak can no longer suppress a workload that
 * sits idle 99.9% of the time. Severity is graded by the estimated wasted RU/s
 * (provisioned minus what p99 demand needs), so a large absolute waste ranks
 * ahead of a small one. Pure.
 */
export function evaluateOverProvisioning(
    p99Percent: number | undefined,
    thresholdPercent: number,
    hasManualThroughput: boolean,
    provisionedRuTotal?: number,
): DerivedAdvisory | undefined {
    if (!hasManualThroughput || p99Percent === undefined || p99Percent >= thresholdPercent) {
        return undefined;
    }
    const p99 = Math.round(p99Percent);
    const threshold = Math.round(thresholdPercent);

    const wastedRu =
        provisionedRuTotal !== undefined && provisionedRuTotal > 0
            ? Math.round(provisionedRuTotal * (1 - p99Percent / 100))
            : undefined;
    let severity: DerivedAdvisorySeverity = 'Medium';
    if (wastedRu !== undefined) {
        severity =
            wastedRu >= OVERPROVISIONING_HIGH_WASTED_RU
                ? 'High'
                : wastedRu >= OVERPROVISIONING_MEDIUM_WASTED_RU
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
    if (maxPercent < thresholds.maxPercent || avgPercent > thresholds.avgPercent || peakToAvg < thresholds.peakToAvgRatio) {
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
        thresholdReference: l10n.t(
            'Threshold: peak ≥ {max}%, average ≤ {avg}%, and peak/average ≥ {ratio}×',
            { max: thresholds.maxPercent, avg: thresholds.avgPercent, ratio: thresholds.peakToAvgRatio },
        ),
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
        soonest.days <= STORAGE_GROWTH_HIGH_DAYS ? 'High' : soonest.days <= STORAGE_GROWTH_MEDIUM_DAYS ? 'Medium' : 'Low';
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
    /** Account-wide RU trend points for the sustained-throttling rule (typically the last 24h). */
    throttlingPoints: readonly RuTrendPoint[];
    /** Account-wide 7-day RU% samples for the over-provisioning + autoscale rules. */
    weeklyRuPercents: readonly number[];
    /** Max of `weeklyRuPercents`, or undefined when no 7-day data is available. */
    weeklyPeakPercent?: number;
    /** True when at least one container/database uses manual (non-autoscale, non-serverless) throughput. */
    hasManualThroughput: boolean;
    /** Total provisioned RU/s across manual-throughput containers, for over-provisioning materiality. */
    manualProvisionedRuTotal?: number;
    /** Per-container top physical-partition RU share (and partition count) over the last hour. */
    partitions: readonly { databaseId: string; containerId: string; topPartitionShare: number; partitionCount: number }[];
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

    let hotPartitionPresent = false;
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
            hotPartitionPresent = true;
        }
    }

    const throttling = evaluateSustainedThrottling(
        throttledBucketShare(inputs.throttlingPoints),
        thresholds.throttledBucketSharePercent,
        hotPartitionPresent,
    );
    if (throttling) {
        advisories.push(throttling);
    }

    const overProvisioning = evaluateOverProvisioning(
        percentile(inputs.weeklyRuPercents, 99),
        thresholds.overProvisioningPeakPercent,
        inputs.hasManualThroughput,
        inputs.manualProvisionedRuTotal,
    );
    if (overProvisioning) {
        advisories.push(overProvisioning);
    }

    const autoscale = evaluateAutoscaleCandidate(
        inputs.weeklyPeakPercent ?? (inputs.weeklyRuPercents.length > 0 ? Math.max(...inputs.weeklyRuPercents) : undefined),
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

    const storageResults = await Promise.all(
        scanTargets.map((row) =>
            getPartitionStorageSeries(monitorClient, accountId, '7D', row.databaseId, row.containerId).catch(
                () => undefined,
            ),
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
            throttlingPoints: dayTrends.points,
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
