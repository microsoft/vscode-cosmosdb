/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    coefficientOfVariation,
    compareAdvisories,
    computeDerivedAdvisories,
    DEFAULT_ADVISORY_THRESHOLDS,
    evaluateAutoscaleCandidate,
    evaluateHotPartitionRisk,
    evaluateIndexingCostRisk,
    evaluateOverProvisioning,
    evaluateSustainedThrottling,
    longestThrottledRunMs,
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

describe('coefficientOfVariation', () => {
    it('is zero for an empty series', () => {
        expect(coefficientOfVariation([])).toBe(0);
    });

    it('is zero for a flat series', () => {
        expect(coefficientOfVariation([50, 50, 50])).toBe(0);
    });

    it('grows with dispersion', () => {
        expect(coefficientOfVariation([10, 90, 10, 90])).toBeGreaterThan(0.5);
    });
});

describe('evaluateHotPartitionRisk', () => {
    it('fires above the threshold and names the container and share', () => {
        const advisory = evaluateHotPartitionRisk('db', 'orders', 55, 40);
        expect(advisory?.rule).toBe('HotPartitionRisk');
        expect(advisory?.severity).toBe('High');
        expect(advisory?.scope).toBe(containerKey('db', 'orders'));
        expect(advisory?.rationale).toContain('55%');
        expect(advisory?.rationale).toContain('orders');
        expect(advisory?.rationale.length).toBeLessThanOrEqual(500);
    });

    it('fires at the threshold (matching the heatmap hot flag) but not below it', () => {
        expect(evaluateHotPartitionRisk('db', 'orders', 40, 40)?.rule).toBe('HotPartitionRisk');
        expect(evaluateHotPartitionRisk('db', 'orders', 39, 40)).toBeUndefined();
    });

    it('never fires when the threshold is disabled (0)', () => {
        expect(evaluateHotPartitionRisk('db', 'orders', 100, 0)).toBeUndefined();
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
    it('fires on low peak with manual throughput', () => {
        const advisory = evaluateOverProvisioning(12, 25, true);
        expect(advisory?.rule).toBe('OverProvisioning');
        expect(advisory?.severity).toBe('Medium');
        expect(advisory?.rationale).toContain('12%');
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
    it('fires on high variability with manual throughput', () => {
        const advisory = evaluateAutoscaleCandidate(0.8, 0.5, true);
        expect(advisory?.rule).toBe('AutoscaleCandidate');
        expect(advisory?.rationale.length).toBeLessThanOrEqual(500);
    });

    it('does not fire at or below the CoV threshold or without manual throughput', () => {
        expect(evaluateAutoscaleCandidate(0.5, 0.5, true)).toBeUndefined();
        expect(evaluateAutoscaleCandidate(0.8, 0.5, false)).toBeUndefined();
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
        const high = evaluateHotPartitionRisk('db', 'a', 90, 40)!;
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

    it('fires each rule and returns them severity-sorted', () => {
        const inputs: DerivedAdvisoryInputs = {
            // Six consecutive throttled 5-min buckets = 30 minutes.
            throttlingPoints: throttledPoints([true, true, true, true, true, true]),
            throttlingBucketMs: 5 * MIN,
            weeklyRuPercents: [5, 95, 5, 95],
            weeklyPeakPercent: 20,
            hasManualThroughput: true,
            partitions: [{ databaseId: 'db', containerId: 'orders', topPartitionShare: 60 }],
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
        expect(rules).toContain('AutoscaleCandidate');
        expect(rules).toContain('IndexingCostRisk');
        // High-severity rules sort ahead of Medium/Low.
        expect(advisories[0].severity).toBe('High');
        expect(advisories.every((a) => a.rationale.length <= 500)).toBe(true);
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
