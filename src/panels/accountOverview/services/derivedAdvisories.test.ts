/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    compareAdvisories,
    computeDerivedAdvisories,
    balanceRatio,
    daysToStorageLimit,
    DEFAULT_ADVISORY_THRESHOLDS,
    evaluateAutoscaleCandidate,
    evaluateHotPartitionRisk,
    evaluateIndexingCostRisk,
    evaluateOverProvisioning,
    evaluateStorageGrowthRisk,
    evaluateStorageSkewRisk,
    evaluateSustainedThrottling,
    fairShareMultiple,
    mean,
    percentile,
    storageGrowthSlopeBytesPerDay,
    throttledBucketShare,
    type AutoscaleThresholds,
    type ContainerStorageInput,
    type DerivedAdvisoryInputs,
} from './derivedAdvisories';
import { type RuTrendPoint } from './ruTrends';
import { containerKey } from './shared';

const MIN = 60 * 1000;

function throttledPoints(pattern: boolean[], bucketMs = 5 * MIN): RuTrendPoint[] {
    return pattern.map((throttled, index) => ({
        timestamp: index * bucketMs,
        ruPercent: throttled ? 100 : 10,
        throttled,
    }));
}

describe('throttledBucketShare', () => {
    it('is zero for an empty series', () => {
        expect(throttledBucketShare([])).toBe(0);
    });

    it('is the fraction of throttled buckets, counting intermittent throttling', () => {
        // Two separate runs, four throttled of six buckets.
        expect(throttledBucketShare(throttledPoints([true, true, false, true, true, false]))).toBeCloseTo(4 / 6);
    });
});

describe('mean', () => {
    it('is zero for an empty series', () => {
        expect(mean([])).toBe(0);
    });

    it('averages the finite values', () => {
        expect(mean([10, 20, 30])).toBe(20);
    });
});

describe('percentile', () => {
    it('is undefined for an empty series', () => {
        expect(percentile([], 99)).toBeUndefined();
    });

    it('ignores a lone high spike at p99 (spike-resistant)', () => {
        // 99 threes and one 100: p99 sits at the top of the steady band, not the spike.
        const values = [...Array<number>(99).fill(3), 100];
        expect(percentile(values, 99)).toBeLessThan(10);
    });

    it('returns the max at p100 and the min at p0', () => {
        expect(percentile([10, 20, 30], 100)).toBe(30);
        expect(percentile([10, 20, 30], 0)).toBe(10);
    });
});

describe('fairShareMultiple', () => {
    it('is 1.0 for a balanced two-partition split', () => {
        expect(fairShareMultiple(50, 2)).toBeCloseTo(1);
    });

    it('is 7.0 for one partition at 35% of a 20-partition container', () => {
        expect(fairShareMultiple(35, 20)).toBeCloseTo(7);
    });

    it('is 0 for a single-partition or empty container', () => {
        expect(fairShareMultiple(100, 1)).toBe(0);
        expect(fairShareMultiple(0, 4)).toBe(0);
    });
});

describe('evaluateHotPartitionRisk', () => {
    it('fires above the fair-share multiple and names the container, share, and count', () => {
        // 60% of 4 partitions = 2.4× fair share, above the 2× threshold used here.
        const advisory = evaluateHotPartitionRisk('db', 'orders', 60, 4, 2);
        expect(advisory?.rule).toBe('HotPartitionRisk');
        expect(advisory?.severity).toBe('High');
        expect(advisory?.scope).toBe(containerKey('db', 'orders'));
        expect(advisory?.rationale).toContain('60%');
        expect(advisory?.rationale).toContain('orders');
        expect(advisory?.rationale.length).toBeLessThanOrEqual(500);
    });

    it('does not fire for a balanced split regardless of partition count', () => {
        // 50/50 → multiple 1.0; 25/25/25/25 → multiple 1.0. Both below the default 3× threshold.
        expect(evaluateHotPartitionRisk('db', 'orders', 50, 2, 3)).toBeUndefined();
        expect(evaluateHotPartitionRisk('db', 'orders', 25, 4, 3)).toBeUndefined();
    });

    it('fires on a high-count hotspot a raw-share cutoff would miss', () => {
        // 35% of 20 partitions = 7× fair share (a raw 40% share cutoff never flags it).
        expect(evaluateHotPartitionRisk('db', 'orders', 35, 20, 3)?.rule).toBe('HotPartitionRisk');
    });

    it('never fires when the threshold is disabled (0)', () => {
        expect(evaluateHotPartitionRisk('db', 'orders', 100, 5, 0)).toBeUndefined();
    });
});

describe('evaluateSustainedThrottling', () => {
    it('fires when the throttled share meets the threshold and grades severity by share', () => {
        // 30% of intervals throttled → High.
        const advisory = evaluateSustainedThrottling(0.3, 5, false);
        expect(advisory?.rule).toBe('SustainedThrottlingInRegion');
        expect(advisory?.severity).toBe('High');
        expect(advisory?.rationale).toContain('30%');
        expect(advisory?.rationale.length).toBeLessThanOrEqual(500);
        // 6% of intervals throttled → Medium.
        expect(evaluateSustainedThrottling(0.06, 5, false)?.severity).toBe('Medium');
    });

    it('splits remediation copy by root cause (add RU vs re-key)', () => {
        const underProvisioned = evaluateSustainedThrottling(0.3, 5, false);
        expect(underProvisioned?.suggestedAction).toContain('throughput');
        const hotPartition = evaluateSustainedThrottling(0.3, 5, true);
        expect(hotPartition?.suggestedAction).toContain('Re-key');
    });

    it('does not fire below the configured share', () => {
        expect(evaluateSustainedThrottling(0.02, 5, false)).toBeUndefined();
    });
});

describe('evaluateOverProvisioning', () => {
    it('fires on low p99 with manual throughput', () => {
        const advisory = evaluateOverProvisioning(12, 25, true);
        expect(advisory?.rule).toBe('OverProvisioning');
        expect(advisory?.severity).toBe('Medium');
        expect(advisory?.rationale).toContain('12%');
    });

    it('grades severity by estimated wasted RU/s when provisioned total is known', () => {
        // 10% p99 of 100,000 provisioned RU/s → ~90,000 wasted → High.
        expect(evaluateOverProvisioning(10, 25, true, 100_000)?.severity).toBe('High');
        // 10% p99 of 2,000 provisioned RU/s → ~1,800 wasted → Medium.
        expect(evaluateOverProvisioning(10, 25, true, 2_000)?.severity).toBe('Medium');
        // 10% p99 of 500 provisioned RU/s → ~450 wasted → Low.
        expect(evaluateOverProvisioning(10, 25, true, 500)?.severity).toBe('Low');
    });

    it('does not fire without manual throughput', () => {
        expect(evaluateOverProvisioning(12, 25, false)).toBeUndefined();
    });

    it('does not fire at or above the threshold, or with no data', () => {
        expect(evaluateOverProvisioning(25, 25, true)).toBeUndefined();
        expect(evaluateOverProvisioning(undefined, 25, true)).toBeUndefined();
    });
});

describe('evaluateAutoscaleCandidate', () => {
    const dutyCycle: AutoscaleThresholds = { maxPercent: 40, avgPercent: 30, peakToAvgRatio: 5 };

    it('fires on a tall peak over a mostly-idle baseline with manual throughput', () => {
        // peak 80, avg 10 → 8× burst: real peak, mostly idle, big ratio.
        const advisory = evaluateAutoscaleCandidate(80, 10, dutyCycle, true);
        expect(advisory?.rule).toBe('AutoscaleCandidate');
        expect(advisory?.rationale).toContain('80%');
        expect(advisory?.rationale.length).toBeLessThanOrEqual(500);
    });

    it('does not fire for steady high load (low duty cycle) even with high variance', () => {
        // Oscillating 40↔60: peak 60, avg 50 → ratio 1.2, well below 5 → autoscale would cost more.
        expect(evaluateAutoscaleCandidate(60, 50, dutyCycle, true)).toBeUndefined();
    });

    it('does not fire when the peak is too low to need capacity, or without manual throughput', () => {
        expect(evaluateAutoscaleCandidate(30, 3, dutyCycle, true)).toBeUndefined();
        expect(evaluateAutoscaleCandidate(80, 10, dutyCycle, false)).toBeUndefined();
    });
});

describe('evaluateIndexingCostRisk', () => {
    it('fires when index/data ratio is high and no paths are excluded', () => {
        const advisory = evaluateIndexingCostRisk(
            { databaseId: 'db', containerId: 'events', indexUsageBytes: 50, dataUsageBytes: 100, excludedPathCount: 0 },
            0.3,
        );
        expect(advisory?.rule).toBe('IndexingCostRisk');
        expect(advisory?.severity).toBe('Low');
        expect(advisory?.rationale).toContain('50%');
    });

    it('does not fire when paths are excluded', () => {
        expect(
            evaluateIndexingCostRisk(
                {
                    databaseId: 'db',
                    containerId: 'events',
                    indexUsageBytes: 50,
                    dataUsageBytes: 100,
                    excludedPathCount: 2,
                },
                0.3,
            ),
        ).toBeUndefined();
    });

    it('does not fire below the ratio, or with missing/zero data usage', () => {
        expect(
            evaluateIndexingCostRisk(
                {
                    databaseId: 'db',
                    containerId: 'events',
                    indexUsageBytes: 20,
                    dataUsageBytes: 100,
                    excludedPathCount: 0,
                },
                0.3,
            ),
        ).toBeUndefined();
        expect(
            evaluateIndexingCostRisk(
                {
                    databaseId: 'db',
                    containerId: 'events',
                    indexUsageBytes: 50,
                    dataUsageBytes: 0,
                    excludedPathCount: 0,
                },
                0.3,
            ),
        ).toBeUndefined();
        expect(
            evaluateIndexingCostRisk(
                { databaseId: 'db', containerId: 'events', dataUsageBytes: 100, excludedPathCount: 0 },
                0.3,
            ),
        ).toBeUndefined();
    });
});

const GIB = 1024 ** 3;
const DAY = 24 * 60 * 60 * 1000;

/** Builds a physical-partition storage series from per-day sizes in GiB (day 0 → oldest). */
function storageSeries(partitionId: string, gibPerDay: number[]): ContainerStorageInput['partitions'][number] {
    return {
        partitionId,
        samples: gibPerDay.map((gib, day) => ({ timestamp: day * DAY, bytes: gib * GIB })),
    };
}

describe('storageGrowthSlopeBytesPerDay', () => {
    it('is undefined for fewer than two datapoints', () => {
        expect(storageGrowthSlopeBytesPerDay([{ timestamp: 0, bytes: GIB }])).toBeUndefined();
    });

    it('fits a linear trend in bytes/day', () => {
        const slope = storageGrowthSlopeBytesPerDay([
            { timestamp: 0, bytes: 10 * GIB },
            { timestamp: DAY, bytes: 11 * GIB },
            { timestamp: 2 * DAY, bytes: 12 * GIB },
        ]);
        expect(slope).toBeCloseTo(GIB, -6);
    });

    it('is undefined for a flat series (zero variance in x collapses to no trend)', () => {
        expect(
            storageGrowthSlopeBytesPerDay([
                { timestamp: 0, bytes: 5 * GIB },
                { timestamp: 0, bytes: 9 * GIB },
            ]),
        ).toBeUndefined();
    });
});

describe('daysToStorageLimit', () => {
    it('projects days to the limit at the given slope', () => {
        expect(daysToStorageLimit(40 * GIB, GIB, 50 * GIB)).toBeCloseTo(10, 5);
    });

    it('is 0 when already at or over the limit', () => {
        expect(daysToStorageLimit(50 * GIB, GIB, 50 * GIB)).toBe(0);
    });

    it('is undefined for a flat or shrinking trajectory', () => {
        expect(daysToStorageLimit(40 * GIB, 0, 50 * GIB)).toBeUndefined();
        expect(daysToStorageLimit(40 * GIB, -GIB, 50 * GIB)).toBeUndefined();
    });
});

describe('evaluateStorageGrowthRisk', () => {
    const container = (partitions: ContainerStorageInput['partitions']): ContainerStorageInput => ({
        databaseId: 'db',
        containerId: 'orders',
        partitions,
    });

    it('fires High when a partition is within 30 days of the 50 GiB ceiling', () => {
        // 44 GiB now, +1 GiB/day → ~6 days to 50 GiB.
        const advisory = evaluateStorageGrowthRisk(container([storageSeries('0', [41, 42, 43, 44])]), 180);
        expect(advisory?.rule).toBe('StorageGrowthRisk');
        expect(advisory?.severity).toBe('High');
        expect(advisory?.scope).toBe(containerKey('db', 'orders'));
    });

    it('grades severity Medium/Low by horizon', () => {
        // 30 GiB now, +0.5 GiB/day → 40 days to 50 GiB → Medium.
        const medium = evaluateStorageGrowthRisk(container([storageSeries('0', [28.5, 29, 29.5, 30])]), 180);
        expect(medium?.severity).toBe('Medium');
        // 20 GiB now, +0.2 GiB/day → 150 days → Low (within 180-day horizon).
        const low = evaluateStorageGrowthRisk(container([storageSeries('0', [19.4, 19.6, 19.8, 20])]), 180);
        expect(low?.severity).toBe('Low');
    });

    it('does not fire beyond the configured horizon', () => {
        // 40 days to limit but horizon is 30 → no fire.
        expect(evaluateStorageGrowthRisk(container([storageSeries('0', [28.5, 29, 29.5, 30])]), 30)).toBeUndefined();
    });

    it('ignores immaterial (< 1 GiB) partitions', () => {
        // 0.5 GiB growing fast is still tiny.
        expect(
            evaluateStorageGrowthRisk(container([storageSeries('0', [0.1, 0.2, 0.3, 0.5])]), 180),
        ).toBeUndefined();
    });

    it('ignores flat/noisy (< 0.1 GiB/day) partitions', () => {
        // 45 GiB but essentially flat → never projected to reach the wall in a meaningful horizon.
        expect(
            evaluateStorageGrowthRisk(container([storageSeries('0', [45, 45, 45, 45])]), 180),
        ).toBeUndefined();
    });

    it('reports the soonest-to-fill partition across the container', () => {
        const advisory = evaluateStorageGrowthRisk(
            container([storageSeries('slow', [10, 11, 12, 13]), storageSeries('fast', [43, 45, 47, 49])]),
            180,
        );
        expect(advisory?.severity).toBe('High');
    });
});

describe('balanceRatio', () => {
    it('is undefined for fewer than two sizes', () => {
        expect(balanceRatio([5 * GIB])).toBeUndefined();
    });

    it('is 1 for a perfectly balanced split', () => {
        expect(balanceRatio([10 * GIB, 10 * GIB, 10 * GIB])).toBe(1);
    });

    it('is min/max for an imbalanced split', () => {
        expect(balanceRatio([2 * GIB, 10 * GIB])).toBeCloseTo(0.2, 5);
    });
});

describe('evaluateStorageSkewRisk', () => {
    const container = (partitions: ContainerStorageInput['partitions']): ContainerStorageInput => ({
        databaseId: 'db',
        containerId: 'orders',
        partitions,
    });

    it('does not fire on a balanced split regardless of size', () => {
        expect(
            evaluateStorageSkewRisk(container([storageSeries('0', [30]), storageSeries('1', [30])]), 0.7),
        ).toBeUndefined();
    });

    it('does not fire on an imbalanced but immaterial (< 1 GiB busiest) split', () => {
        // 0.1 GiB vs 0.5 GiB → ratio 0.2 but busiest is tiny.
        expect(
            evaluateStorageSkewRisk(container([storageSeries('0', [0.1]), storageSeries('1', [0.5])]), 0.7),
        ).toBeUndefined();
    });

    it('fires Low when imbalanced with a material-but-small busiest partition', () => {
        // 2 GiB vs 10 GiB → ratio 0.2, busiest 10 GiB (< 25 GiB) → Low.
        const advisory = evaluateStorageSkewRisk(container([storageSeries('0', [2]), storageSeries('1', [10])]), 0.7);
        expect(advisory?.rule).toBe('StorageSkewRisk');
        expect(advisory?.severity).toBe('Low');
        expect(advisory?.scope).toBe(containerKey('db', 'orders'));
    });

    it('grades severity by the busiest partition proximity to 50 GiB', () => {
        // busiest 30 GiB (≥ 25) → Medium.
        const medium = evaluateStorageSkewRisk(container([storageSeries('0', [5]), storageSeries('1', [30])]), 0.7);
        expect(medium?.severity).toBe('Medium');
        // busiest 45 GiB (≥ 40) → High.
        const high = evaluateStorageSkewRisk(container([storageSeries('0', [5]), storageSeries('1', [45])]), 0.7);
        expect(high?.severity).toBe('High');
    });

    it('uses the latest size of each partition series', () => {
        // Both grow but end balanced (20 vs 20) → no skew even though they started uneven.
        expect(
            evaluateStorageSkewRisk(container([storageSeries('0', [2, 20]), storageSeries('1', [18, 20])]), 0.7),
        ).toBeUndefined();
    });
});

describe('compareAdvisories', () => {
    it('orders High before Medium before Low', () => {
        const high = evaluateHotPartitionRisk('db', 'a', 90, 4, 3)!;
        const medium = evaluateOverProvisioning(10, 25, true)!;
        const low = evaluateIndexingCostRisk(
            { databaseId: 'db', containerId: 'b', indexUsageBytes: 50, dataUsageBytes: 100, excludedPathCount: 0 },
            0.3,
        )!;
        const sorted = [low, medium, high].sort(compareAdvisories);
        expect(sorted.map((a) => a.severity)).toEqual(['High', 'Medium', 'Low']);
    });
});

describe('computeDerivedAdvisories', () => {
    const baseInputs: DerivedAdvisoryInputs = {
        throttlingPoints: throttledPoints([false, false, false]),
        weeklyRuPercents: [50, 50, 50],
        weeklyPeakPercent: 50,
        hasManualThroughput: false,
        partitions: [],
        storage: [],
        indexing: [],
    };

    it('returns no advisories when nothing crosses a threshold', () => {
        expect(computeDerivedAdvisories(baseInputs, DEFAULT_ADVISORY_THRESHOLDS)).toEqual([]);
    });

    it('fires the high-severity + over-provisioning rules and returns them severity-sorted', () => {
        const inputs: DerivedAdvisoryInputs = {
            // All six 24h intervals throttled → 100% throttled share.
            throttlingPoints: throttledPoints([true, true, true, true, true, true]),
            weeklyRuPercents: [20, 20, 20, 20],
            weeklyPeakPercent: 20,
            hasManualThroughput: true,
            partitions: [{ databaseId: 'db', containerId: 'orders', topPartitionShare: 80, partitionCount: 5 }],
            storage: [],
            indexing: [
                {
                    databaseId: 'db',
                    containerId: 'events',
                    indexUsageBytes: 80,
                    dataUsageBytes: 100,
                    excludedPathCount: 0,
                },
            ],
        };
        const advisories = computeDerivedAdvisories(inputs, DEFAULT_ADVISORY_THRESHOLDS);
        const rules = advisories.map((a) => a.rule);
        expect(rules).toContain('HotPartitionRisk');
        expect(rules).toContain('SustainedThrottlingInRegion');
        expect(rules).toContain('OverProvisioning');
        expect(rules).toContain('IndexingCostRisk');
        // High-severity rules sort ahead of Medium/Low.
        expect(advisories[0].severity).toBe('High');
        expect(advisories.every((a) => a.rationale.length <= 500)).toBe(true);
    });

    it('fires AutoscaleCandidate on a bursty manual profile (mutually exclusive with over-provisioning)', () => {
        const inputs: DerivedAdvisoryInputs = {
            ...baseInputs,
            // Mostly idle at 5% with a single 90% burst → avg ≈ 15.6%, peak 90%, ratio ≈ 5.8×.
            weeklyRuPercents: [5, 5, 5, 5, 5, 5, 5, 90],
            weeklyPeakPercent: 90,
            hasManualThroughput: true,
        };
        const rules = computeDerivedAdvisories(inputs, DEFAULT_ADVISORY_THRESHOLDS).map((a) => a.rule);
        expect(rules).toContain('AutoscaleCandidate');
        expect(rules).not.toContain('OverProvisioning');
    });

    it('gates over/under-provisioning rules on manual throughput', () => {
        const inputs: DerivedAdvisoryInputs = {
            ...baseInputs,
            weeklyRuPercents: [5, 95, 5, 95],
            weeklyPeakPercent: 10,
            hasManualThroughput: false,
        };
        const rules = computeDerivedAdvisories(inputs, DEFAULT_ADVISORY_THRESHOLDS).map((a) => a.rule);
        expect(rules).not.toContain('OverProvisioning');
        expect(rules).not.toContain('AutoscaleCandidate');
    });
});
