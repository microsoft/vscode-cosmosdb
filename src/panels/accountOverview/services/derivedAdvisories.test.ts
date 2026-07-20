/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    compareAdvisories,
    computeDerivedAdvisories,
    DEFAULT_ADVISORY_THRESHOLDS,
    evaluateAutoscaleCandidate,
    evaluateHotPartitionRisk,
    evaluateIndexingCostRisk,
    evaluateOverProvisioning,
    evaluateSustainedThrottling,
    fairShareMultiple,
    longestThrottledRunMs,
    mean,
    percentile,
    type AutoscaleThresholds,
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

describe('longestThrottledRunMs', () => {
    it('is zero when nothing is throttled', () => {
        expect(longestThrottledRunMs(throttledPoints([false, false, false]), 5 * MIN)).toBe(0);
    });

    it('measures the longest continuous run, not the total', () => {
        // Two separate 2-bucket runs; the longest is 2 buckets = 10 minutes.
        const points = throttledPoints([true, true, false, true, true, false]);
        expect(longestThrottledRunMs(points, 5 * MIN)).toBe(2 * 5 * MIN);
    });

    it('sorts unordered points before scanning', () => {
        const points: RuTrendPoint[] = [
            { timestamp: 30 * MIN, throttled: true },
            { timestamp: 0, throttled: true },
            { timestamp: 15 * MIN, throttled: true },
        ];
        // Reordered: three consecutive throttled buckets.
        expect(longestThrottledRunMs(points, 5 * MIN)).toBe(3 * 5 * MIN);
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
    it('fires when the run meets the configured minutes', () => {
        const advisory = evaluateSustainedThrottling(30 * MIN, 30);
        expect(advisory?.rule).toBe('SustainedThrottlingInRegion');
        expect(advisory?.severity).toBe('High');
        expect(advisory?.rationale).toContain('30');
        expect(advisory?.rationale.length).toBeLessThanOrEqual(500);
    });

    it('does not fire below the configured minutes', () => {
        expect(evaluateSustainedThrottling(25 * MIN, 30)).toBeUndefined();
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
        throttlingBucketMs: 5 * MIN,
        weeklyRuPercents: [50, 50, 50],
        weeklyPeakPercent: 50,
        hasManualThroughput: false,
        partitions: [],
        indexing: [],
    };

    it('returns no advisories when nothing crosses a threshold', () => {
        expect(computeDerivedAdvisories(baseInputs, DEFAULT_ADVISORY_THRESHOLDS)).toEqual([]);
    });

    it('fires the high-severity + over-provisioning rules and returns them severity-sorted', () => {
        const inputs: DerivedAdvisoryInputs = {
            // Six consecutive throttled 5-min buckets = 30 minutes.
            throttlingPoints: throttledPoints([true, true, true, true, true, true]),
            throttlingBucketMs: 5 * MIN,
            weeklyRuPercents: [20, 20, 20, 20],
            weeklyPeakPercent: 20,
            hasManualThroughput: true,
            partitions: [{ databaseId: 'db', containerId: 'orders', topPartitionShare: 80, partitionCount: 5 }],
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
