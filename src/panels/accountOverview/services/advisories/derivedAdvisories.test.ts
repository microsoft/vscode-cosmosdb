/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    AutoscaleCandidateDetector,
    AutoscaleMaxOverProvisionedDetector,
    AutoscaleToManualCandidateDetector,
    balanceRatio,
    compareAdvisories,
    computeDerivedAdvisories,
    daysToStorageLimit,
    DEFAULT_ADVISORY_THRESHOLDS,
    ExpensiveConsistencyDetector,
    HotPartitionRiskDetector,
    IdleContainerDetector,
    IndexingCostRiskDetector,
    mean,
    MultiRegionWriteAntipatternDetector,
    OverProvisioningDetector,
    PartitionMergeCandidateDetector,
    ServerlessCandidateDetector,
    storageGrowthSlopeBytesPerDay,
    StorageGrowthRiskDetector,
    StorageSkewRiskDetector,
    UnderProvisioningDetector,
    type AccountConfigInput,
    type AutoscaleThresholds,
    type AutoscaleUtilizationInput,
    type ContainerStorageInput,
    type DerivedAdvisoryInputs,
    type IdleContainerInput,
    type PartitionMergeInput,
    type PartitionSaturationInput,
    type ServerlessCandidateInput,
} from '.';
import { containerKey, percentile } from '../shared';

// Detector classes expose the same `evaluate` signature as the old free functions (a bound field delegating to
// the module-level evaluator), so aliasing keeps every call site below unchanged.
const evaluateAutoscaleCandidate = new AutoscaleCandidateDetector().evaluate;
const evaluateAutoscaleMaxOverProvisioned = new AutoscaleMaxOverProvisionedDetector().evaluate;
const evaluateAutoscaleToManualCandidate = new AutoscaleToManualCandidateDetector().evaluate;
const evaluateExpensiveConsistency = new ExpensiveConsistencyDetector().evaluate;
const evaluateHotPartitionRisk = new HotPartitionRiskDetector().evaluate;
const evaluateIdleContainer = new IdleContainerDetector().evaluate;
const evaluateIndexingCostRisk = new IndexingCostRiskDetector().evaluate;
const evaluateMultiRegionWrites = new MultiRegionWriteAntipatternDetector().evaluate;
const evaluateOverProvisioning = new OverProvisioningDetector().evaluate;
const evaluatePartitionMergeCandidate = new PartitionMergeCandidateDetector().evaluate;
const evaluateServerlessCandidate = new ServerlessCandidateDetector().evaluate;
const evaluateStorageGrowthRisk = new StorageGrowthRiskDetector().evaluate;
const evaluateStorageSkewRisk = new StorageSkewRiskDetector().evaluate;
const evaluateUnderProvisioning = new UnderProvisioningDetector().evaluate;

/** Builds a per-container saturation input with sensible defaults for the hot-partition / under-provisioning rules. */
function partInput(overrides: Partial<PartitionSaturationInput> = {}): PartitionSaturationInput {
    return {
        databaseId: 'db',
        containerId: 'orders',
        maxP99: 95,
        minP99: 30,
        partitionCount: 4,
        throttleRatePercent: 0,
        totalRequests: 5_000,
        throughputMode: 'dedicated',
        provisionedRu: 1_000,
        ...overrides,
    };
}

describe('mean', () => {
    it('is zero for an empty series', () => {
        expect(mean([])).toBe(0);
    });

    it('averages the finite values', () => {
        expect(mean([10, 20, 30])).toBe(20);
    });
});

describe('evaluateHotPartitionRisk', () => {
    it('fires Medium when a partition is saturated while another has headroom (not yet throttling)', () => {
        const advisory = evaluateHotPartitionRisk(partInput(), 90, 70, 1);
        expect(advisory?.rule).toBe('HotPartitionRisk');
        expect(advisory?.severity).toBe('Medium');
        expect(advisory?.scope).toBe(containerKey('db', 'orders'));
        expect(advisory?.rationale).toContain('95%');
        expect(advisory?.rationale).toContain('orders');
        expect(advisory?.rationale.length).toBeLessThanOrEqual(500);
    });

    it('escalates to High when the container is actively throttling', () => {
        expect(evaluateHotPartitionRisk(partInput({ throttleRatePercent: 5 }), 90, 70, 1)?.severity).toBe('High');
    });

    it('does not fire under uniform saturation (no partition has headroom)', () => {
        expect(evaluateHotPartitionRisk(partInput({ minP99: 88 }), 90, 70, 1)).toBeUndefined();
    });

    it('does not fire when nothing is saturated', () => {
        expect(evaluateHotPartitionRisk(partInput({ maxP99: 60 }), 90, 70, 1)).toBeUndefined();
    });

    it('does not fire for a single-partition container', () => {
        expect(evaluateHotPartitionRisk(partInput({ partitionCount: 1 }), 90, 70, 1)).toBeUndefined();
    });
});

describe('evaluateUnderProvisioning', () => {
    it('fires when throttling and every partition is uniformly saturated, grading severity by 429 rate', () => {
        const advisory = evaluateUnderProvisioning(partInput({ minP99: 80, throttleRatePercent: 25 }), 90, 70, 1);
        expect(advisory?.rule).toBe('SustainedThrottlingInRegion');
        expect(advisory?.severity).toBe('High');
        expect(advisory?.scope).toBe(containerKey('db', 'orders'));
        expect(advisory?.rationale).toContain('orders');
        expect(advisory?.rationale.length).toBeLessThanOrEqual(500);
        // 8% rate → Medium.
        expect(evaluateUnderProvisioning(partInput({ minP99: 80, throttleRatePercent: 8 }), 90, 70, 1)?.severity).toBe(
            'Medium',
        );
    });

    it('does not fire on the skew (non-uniform) case — that is the hot-partition rule', () => {
        expect(
            evaluateUnderProvisioning(partInput({ minP99: 40, throttleRatePercent: 25 }), 90, 70, 1),
        ).toBeUndefined();
    });

    it('abstains below the minimum request count', () => {
        expect(
            evaluateUnderProvisioning(
                partInput({ minP99: 80, throttleRatePercent: 25, totalRequests: 500 }),
                90,
                70,
                1,
            ),
        ).toBeUndefined();
    });

    it('does not fire when it is not throttling', () => {
        expect(evaluateUnderProvisioning(partInput({ minP99: 80, throttleRatePercent: 0 }), 90, 70, 1)).toBeUndefined();
    });
});

describe('evaluateOverProvisioning', () => {
    it('fires on low p99 with manual throughput', () => {
        const advisory = evaluateOverProvisioning(12, 12, 30, true);
        expect(advisory?.rule).toBe('OverProvisioning');
        expect(advisory?.severity).toBe('Medium');
        expect(advisory?.rationale).toContain('12%');
    });

    it('grades severity by relative materiality when the provisioned total is known', () => {
        // Big fleet with tiny demand → most capacity wasted → High.
        expect(evaluateOverProvisioning(10, 10, 30, true, 100_000)?.severity).toBe('High');
        // Just above the 400 RU/s floor → ~5% wasted → Medium.
        expect(evaluateOverProvisioning(10, 10, 30, true, 420)?.severity).toBe('Medium');
        // Barely above the floor → ~0.5% wasted → Low.
        expect(evaluateOverProvisioning(10, 10, 30, true, 402)?.severity).toBe('Low');
    });

    it('does not fire without manual throughput', () => {
        expect(evaluateOverProvisioning(12, 12, 30, false)).toBeUndefined();
    });

    it('does not fire at or above the band, or with no data', () => {
        expect(evaluateOverProvisioning(30, 30, 30, true)).toBeUndefined();
        expect(evaluateOverProvisioning(undefined, undefined, 30, true)).toBeUndefined();
    });

    it('is suppressed by the peak-saturation guard (a recurring batch needs its peak)', () => {
        expect(evaluateOverProvisioning(10, 95, 30, true, 100_000)).toBeUndefined();
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
        expect(evaluateStorageGrowthRisk(container([storageSeries('0', [0.1, 0.2, 0.3, 0.5])]), 180)).toBeUndefined();
    });

    it('ignores flat/noisy (< 0.1 GiB/day) partitions', () => {
        // 45 GiB but essentially flat → never projected to reach the wall in a meaningful horizon.
        expect(evaluateStorageGrowthRisk(container([storageSeries('0', [45, 45, 45, 45])]), 180)).toBeUndefined();
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
        const high = evaluateHotPartitionRisk(partInput({ throttleRatePercent: 5 }), 90, 70, 1)!;
        const medium = evaluateOverProvisioning(10, 10, 30, true)!;
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

    it('fires the hot-partition + over-provisioning + indexing rules and returns them severity-sorted', () => {
        const inputs: DerivedAdvisoryInputs = {
            weeklyRuPercents: [20, 20, 20, 20],
            weeklyPeakPercent: 20,
            hasManualThroughput: true,
            partitions: [partInput({ minP99: 30, throttleRatePercent: 5 })],
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
        expect(rules).toContain('OverProvisioning');
        expect(rules).toContain('IndexingCostRisk');
        // The skewed hot partition must not also raise the uniform-saturation under-provisioning advisory.
        expect(rules).not.toContain('SustainedThrottlingInRegion');
        expect(advisories[0].severity).toBe('High');
        expect(advisories.every((a) => a.rationale.length <= 500)).toBe(true);
    });

    it('fires SustainedThrottlingInRegion (not hot partition) on uniform saturation with throttling', () => {
        const inputs: DerivedAdvisoryInputs = {
            ...baseInputs,
            partitions: [partInput({ minP99: 80, throttleRatePercent: 25 })],
        };
        const rules = computeDerivedAdvisories(inputs, DEFAULT_ADVISORY_THRESHOLDS).map((a) => a.rule);
        expect(rules).toContain('SustainedThrottlingInRegion');
        expect(rules).not.toContain('HotPartitionRisk');
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

describe('evaluateExpensiveConsistency', () => {
    function config(overrides: Partial<AccountConfigInput> = {}): AccountConfigInput {
        return {
            accountName: 'orders-prod',
            regionCount: 2,
            multiRegionWritesEnabled: false,
            writeRegionCount: 1,
            apiKind: 'core',
            ...overrides,
        };
    }

    it('fires Medium on Strong consistency across ≥ 2 regions', () => {
        const advisory = evaluateExpensiveConsistency(config({ consistencyLevel: 'Strong', regionCount: 3 }));
        expect(advisory?.rule).toBe('ExpensiveConsistency');
        expect(advisory?.severity).toBe('Medium');
    });

    it('fires Low on Bounded Staleness across ≥ 2 regions', () => {
        const advisory = evaluateExpensiveConsistency(config({ consistencyLevel: 'BoundedStaleness', regionCount: 2 }));
        expect(advisory?.severity).toBe('Low');
    });

    it('does not fire on a single region (no cross-region cost)', () => {
        expect(evaluateExpensiveConsistency(config({ consistencyLevel: 'Strong', regionCount: 1 }))).toBeUndefined();
    });

    it('does not fire on the Session default', () => {
        expect(evaluateExpensiveConsistency(config({ consistencyLevel: 'Session', regionCount: 3 }))).toBeUndefined();
    });

    it('does not fire when the level is unknown', () => {
        expect(evaluateExpensiveConsistency(config({ consistencyLevel: undefined, regionCount: 3 }))).toBeUndefined();
    });
});

describe('evaluateMultiRegionWrites', () => {
    function config(overrides: Partial<AccountConfigInput> = {}): AccountConfigInput {
        return {
            accountName: 'orders-prod',
            regionCount: 2,
            multiRegionWritesEnabled: true,
            writeRegionCount: 2,
            apiKind: 'core',
            ...overrides,
        };
    }

    it('does not fire when multi-region writes are disabled', () => {
        expect(evaluateMultiRegionWrites(config({ multiRegionWritesEnabled: false }))).toBeUndefined();
    });

    it('fires High on a non-SQL API account (wrong-API misconfiguration)', () => {
        const advisory = evaluateMultiRegionWrites(config({ apiKind: 'mongo' }));
        expect(advisory?.rule).toBe('MultiRegionWriteAntipattern');
        expect(advisory?.severity).toBe('High');
    });

    it('fires Low as a single-write-region tripwire regardless of environment', () => {
        const advisory = evaluateMultiRegionWrites(config({ writeRegionCount: 1 }));
        expect(advisory?.severity).toBe('Low');
    });

    it('treats ≥ 2 write regions in production as legitimate HA (does not fire)', () => {
        expect(evaluateMultiRegionWrites(config({ accountName: 'orders-prod', writeRegionCount: 2 }))).toBeUndefined();
    });

    it('fires Medium on a non-production account with ≥ 2 write regions', () => {
        const advisory = evaluateMultiRegionWrites(config({ accountName: 'orders-dev', writeRegionCount: 2 }));
        expect(advisory?.severity).toBe('Medium');
    });
});

describe('computeDerivedAdvisories with accountConfig', () => {
    const baseInputs: DerivedAdvisoryInputs = {
        weeklyRuPercents: [],
        hasManualThroughput: false,
        partitions: [],
        storage: [],
        indexing: [],
    };

    it('surfaces both config advisories when they fire', () => {
        const rules = computeDerivedAdvisories(
            {
                ...baseInputs,
                accountConfig: {
                    accountName: 'orders-dev',
                    consistencyLevel: 'Strong',
                    regionCount: 2,
                    multiRegionWritesEnabled: true,
                    writeRegionCount: 2,
                    apiKind: 'core',
                },
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        ).map((a) => a.rule);
        expect(rules).toContain('ExpensiveConsistency');
        expect(rules).toContain('MultiRegionWriteAntipattern');
    });

    it('surfaces nothing when accountConfig is absent', () => {
        expect(computeDerivedAdvisories(baseInputs, DEFAULT_ADVISORY_THRESHOLDS)).toHaveLength(0);
    });
});

const GIB_TEST = 1024 ** 3;

function idleInput(overrides: Partial<IdleContainerInput> = {}): IdleContainerInput {
    return {
        databaseId: 'db',
        containerId: 'orders',
        peakRuPerBucket: 10,
        throughputMode: 'dedicated',
        provisionedRu: 1_000,
        ...overrides,
    };
}

describe('evaluateIdleContainer', () => {
    it('fires High for a fully idle manual container (whole reservation recoverable)', () => {
        const advisory = evaluateIdleContainer(idleInput({ peakRuPerBucket: 5 }), 50, 1_000);
        expect(advisory).toMatchObject({ rule: 'IdleContainer', severity: 'High', scope: 'db/orders' });
        expect(advisory?.rationale).toContain('1000 RU/s');
    });

    it('treats an all-zero series as the idle signal', () => {
        expect(evaluateIdleContainer(idleInput({ peakRuPerBucket: 0 }), 50, 1_000)).toBeDefined();
    });

    it('does not fire when the container consumed real RU in some bucket', () => {
        expect(evaluateIdleContainer(idleInput({ peakRuPerBucket: 500 }), 50, 1_000)).toBeUndefined();
    });

    it('recovers only the autoscale idle floor (10% of max) for an idle autoscale container', () => {
        const advisory = evaluateIdleContainer(
            idleInput({ throughputMode: 'autoscale', provisionedRu: 10_000, peakRuPerBucket: 0 }),
            50,
            100_000,
        );
        // Recoverable = 10% of 10,000 = 1,000 RU/s = 1% of the 100,000 scope → Medium.
        expect(advisory).toMatchObject({ rule: 'IdleContainer', severity: 'Medium' });
        expect(advisory?.rationale).toContain('1000 RU/s');
    });

    it('skips serverless containers (no recoverable offer)', () => {
        expect(
            evaluateIdleContainer(idleInput({ throughputMode: 'serverless', provisionedRu: undefined }), 50),
        ).toBeUndefined();
    });
});

function mergeInput(overrides: Partial<PartitionMergeInput> = {}): PartitionMergeInput {
    return {
        databaseId: 'db',
        containerId: 'orders',
        actualPartitions: 4,
        provisionedRu: 10_000,
        dataUsageBytes: 0,
        ...overrides,
    };
}

describe('evaluatePartitionMergeCandidate', () => {
    it('fires Medium when actual partitions are at least twice what is needed', () => {
        // needed = max(ceil(10000/10000)=1, 1, 1) = 1; actual 4 ≥ 2×1.
        const advisory = evaluatePartitionMergeCandidate(mergeInput({ actualPartitions: 4 }));
        expect(advisory).toMatchObject({ rule: 'PartitionMergeCandidate', severity: 'Medium', scope: 'db/orders' });
    });

    it('fires Low when over-partitioned but below twice the need', () => {
        // needed = ceil(15000/10000) = 2; actual 3 > 2 but < 4.
        const advisory = evaluatePartitionMergeCandidate(mergeInput({ actualPartitions: 3, provisionedRu: 15_000 }));
        expect(advisory).toMatchObject({ severity: 'Low' });
    });

    it('never flags a single partition', () => {
        expect(evaluatePartitionMergeCandidate(mergeInput({ actualPartitions: 1 }))).toBeUndefined();
    });

    it('does not fire when the partition count matches the need', () => {
        // needed = ceil(20000/10000) = 2; actual 2.
        expect(
            evaluatePartitionMergeCandidate(mergeInput({ actualPartitions: 2, provisionedRu: 20_000 })),
        ).toBeUndefined();
    });

    it('counts storage toward the need', () => {
        // needed for storage = ceil(120 GiB / 50 GiB) = 3; actual 3 → right-sized.
        expect(
            evaluatePartitionMergeCandidate(
                mergeInput({ actualPartitions: 3, provisionedRu: 1_000, dataUsageBytes: 120 * GIB_TEST }),
            ),
        ).toBeUndefined();
    });
});

function autoUtil(overrides: Partial<AutoscaleUtilizationInput> = {}): AutoscaleUtilizationInput {
    return {
        databaseId: 'db',
        containerId: 'orders',
        peakPercent: 10,
        avgPercent: 5,
        sampleCount: 100,
        configuredMaxRu: 10_000,
        ...overrides,
    };
}

describe('evaluateAutoscaleMaxOverProvisioned', () => {
    it('fires when the peak stayed well below the band (recovers the idle-floor delta)', () => {
        const advisory = evaluateAutoscaleMaxOverProvisioned(autoUtil({ peakPercent: 10 }), 30, 10_000);
        expect(advisory).toMatchObject({ rule: 'AutoscaleMaxOverProvisioned', scope: 'db/orders' });
    });

    it('does not fire when the peak reached the band', () => {
        expect(evaluateAutoscaleMaxOverProvisioned(autoUtil({ peakPercent: 50 }), 30, 10_000)).toBeUndefined();
    });

    it('does not fire when the peak saturates the max (genuinely needed)', () => {
        expect(evaluateAutoscaleMaxOverProvisioned(autoUtil({ peakPercent: 95 }), 30, 10_000)).toBeUndefined();
    });

    it('abstains without samples or a configured max', () => {
        expect(evaluateAutoscaleMaxOverProvisioned(autoUtil({ sampleCount: 0 }), 30)).toBeUndefined();
        expect(evaluateAutoscaleMaxOverProvisioned(autoUtil({ configuredMaxRu: undefined }), 30)).toBeUndefined();
    });
});

describe('evaluateAutoscaleToManualCandidate', () => {
    it('fires Medium for a steady-high autoscale duty cycle', () => {
        const advisory = evaluateAutoscaleToManualCandidate(autoUtil({ avgPercent: 80, peakPercent: 90 }), 66, 1.3);
        expect(advisory).toMatchObject({ rule: 'AutoscaleToManualCandidate', severity: 'Medium', scope: 'db/orders' });
    });

    it('does not fire when the load is bursty (high peak-to-average)', () => {
        expect(
            evaluateAutoscaleToManualCandidate(autoUtil({ avgPercent: 80, peakPercent: 200 }), 66, 1.3),
        ).toBeUndefined();
    });

    it('does not fire when the average is below the floor', () => {
        expect(
            evaluateAutoscaleToManualCandidate(autoUtil({ avgPercent: 40, peakPercent: 45 }), 66, 1.3),
        ).toBeUndefined();
    });
});

function serverlessInput(overrides: Partial<ServerlessCandidateInput> = {}): ServerlessCandidateInput {
    return { avgRuPerSec: 5, peakRuPerSec: 100, sampleCount: 30, isServerless: false, ...overrides };
}

const SERVERLESS_THRESHOLDS = {
    sporadicRatio: DEFAULT_ADVISORY_THRESHOLDS.serverlessSporadicRatio,
    peakFloorRuPerSec: DEFAULT_ADVISORY_THRESHOLDS.serverlessPeakFloorRuPerSec,
    peakCeilingRuPerSec: DEFAULT_ADVISORY_THRESHOLDS.serverlessPeakCeilingRuPerSec,
};

describe('evaluateServerlessCandidate', () => {
    it('fires Low for a low, sporadic account-total shape', () => {
        const advisory = evaluateServerlessCandidate(serverlessInput(), SERVERLESS_THRESHOLDS);
        expect(advisory).toMatchObject({ rule: 'ServerlessCandidate', severity: 'Low' });
        expect(advisory?.scope).toBeUndefined();
    });

    it('never recommends serverless to an account already on serverless', () => {
        expect(
            evaluateServerlessCandidate(serverlessInput({ isServerless: true }), SERVERLESS_THRESHOLDS),
        ).toBeUndefined();
    });

    it('does not fire when the workload is steady (average-to-peak above the ratio)', () => {
        expect(
            evaluateServerlessCandidate(serverlessInput({ avgRuPerSec: 50 }), SERVERLESS_THRESHOLDS),
        ).toBeUndefined();
    });

    it('treats a near-idle account as decommission (below the floor), not serverless', () => {
        expect(
            evaluateServerlessCandidate(serverlessInput({ peakRuPerSec: 5, avgRuPerSec: 0.1 }), SERVERLESS_THRESHOLDS),
        ).toBeUndefined();
    });

    it('steers away workloads above the single-partition ceiling', () => {
        expect(
            evaluateServerlessCandidate(
                serverlessInput({ peakRuPerSec: 6_000, avgRuPerSec: 100 }),
                SERVERLESS_THRESHOLDS,
            ),
        ).toBeUndefined();
    });

    it('abstains without enough history', () => {
        expect(
            evaluateServerlessCandidate(serverlessInput({ sampleCount: 10 }), SERVERLESS_THRESHOLDS),
        ).toBeUndefined();
    });
});

describe('computeDerivedAdvisories with Batch 2 metrics inputs', () => {
    it('surfaces the metrics-based Tier-1 detectors alongside the rest', () => {
        const rules = computeDerivedAdvisories(
            {
                weeklyRuPercents: [],
                hasManualThroughput: false,
                partitions: [],
                storage: [],
                indexing: [],
                idleContainers: [idleInput({ peakRuPerBucket: 0 })],
                partitionMerges: [mergeInput({ actualPartitions: 4 })],
                autoscaleUtilizations: [autoUtil({ avgPercent: 80, peakPercent: 90 })],
                serverless: serverlessInput(),
                scopeProvisionedRuTotal: 1_000,
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        ).map((a) => a.rule);
        expect(rules).toContain('IdleContainer');
        expect(rules).toContain('PartitionMergeCandidate');
        expect(rules).toContain('AutoscaleToManualCandidate');
        expect(rules).toContain('ServerlessCandidate');
    });

    it('surfaces nothing from the new inputs when they are absent', () => {
        expect(
            computeDerivedAdvisories(
                { weeklyRuPercents: [], hasManualThroughput: false, partitions: [], storage: [], indexing: [] },
                DEFAULT_ADVISORY_THRESHOLDS,
            ),
        ).toHaveLength(0);
    });
});

describe('percentile (re-exported signal helper)', () => {
    it('is spike-resistant at p99', () => {
        const values = [...Array<number>(99).fill(3), 100];
        expect(percentile(values, 99)).toBeLessThan(10);
    });
});

describe('computeDerivedAdvisories Tier-2 wiring', () => {
    const tier1Base: DerivedAdvisoryInputs = {
        weeklyRuPercents: [50, 50, 50],
        weeklyPeakPercent: 50,
        hasManualThroughput: false,
        partitions: [],
        storage: [],
        indexing: [],
    };

    it('supersedes the cross-partition advisory with shard-key misalignment on the same container', () => {
        // 85% of executions fan out → past the structural (60%) threshold, so DX-007 fires and DX-002 is dropped.
        const rules = computeDerivedAdvisories(
            {
                ...tier1Base,
                crossPartition: [
                    {
                        databaseId: 'db',
                        containerId: 'orders',
                        shapes: [
                            { text: 'SELECT * FROM c WHERE c.email=@e', executions: 850, avgFanout: 2, maxFanout: 2 },
                            { text: 'SELECT * FROM c WHERE c.pk=@p', executions: 150, avgFanout: 1, maxFanout: 1 },
                        ],
                    },
                ],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        ).filter((a) => a.scope === 'db/orders');
        expect(rules.map((a) => a.rule)).toEqual(['ShardKeyMisalignment']);
    });

    it('keeps the cross-partition advisory when the fan-out share is below the structural threshold', () => {
        // 15% cross → not structural, so DX-002 (Medium) stands and DX-007 does not fire.
        const rules = computeDerivedAdvisories(
            {
                ...tier1Base,
                crossPartition: [
                    {
                        databaseId: 'db',
                        containerId: 'orders',
                        shapes: [
                            { text: 'SELECT * FROM c WHERE c.email=@e', executions: 150, avgFanout: 2, maxFanout: 2 },
                            { text: 'SELECT * FROM c WHERE c.pk=@p', executions: 850, avgFanout: 1, maxFanout: 1 },
                        ],
                    },
                ],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        ).filter((a) => a.scope === 'db/orders');
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({ rule: 'CrossPartitionQuery', severity: 'Medium' });
    });
});
