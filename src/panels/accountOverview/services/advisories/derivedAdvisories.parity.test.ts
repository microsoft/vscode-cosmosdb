/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CODA parity tests (P10.6 Part B).
 *
 * Each `describe` below mirrors, scenario-for-scenario, a CODA detector's own offline unit test so that our ported
 * TypeScript detectors reproduce CODA's classification methodology (positive **and** negative cases). The CODA source
 * fixture is cited on each block; the scenarios are the same input shapes and expected verdicts, re-expressed against
 * our `evaluate*` surface. This is a methodology-parity harness — it deliberately overlaps the behavioural coverage in
 * `derivedAdvisories.test.ts`, but organised by CODA fixture so a reviewer can check parity rule-by-rule.
 *
 * CODA reference repo: azure-data-database-platform/coda — tests/test_*.py.
 */

import { describe, expect, it } from 'vitest';
import {
    AutoscaleCandidateDetector,
    AutoscaleToManualCandidateDetector,
    CrossPartitionQueryDetector,
    DEFAULT_ADVISORY_THRESHOLDS,
    ExpensiveConsistencyDetector,
    HotPartitionRiskDetector,
    IdleContainerDetector,
    MultiRegionWriteAntipatternDetector,
    OverProvisioningDetector,
    PartitionMergeCandidateDetector,
    ServerlessCandidateDetector,
    ShardKeyMisalignmentDetector,
    SharedThroughputStarvationDetector,
    StorageGrowthRiskDetector,
    StorageSkewRiskDetector,
    UncontrolledIngestionDetector,
    UnderProvisioningDetector,
    type AccountConfigInput,
    type AutoscaleThresholds,
    type AutoscaleUtilizationInput,
    type CollectionTrafficInput,
    type ContainerStorageInput,
    type CrossPartitionInput,
    type IdleContainerInput,
    type PartitionMergeInput,
    type PartitionSaturationInput,
    type QueryShapeInput,
    type ServerlessCandidateInput,
    type UncontrolledIngestionInput,
} from '.';

// Detector classes expose the same `evaluate` signature as the old free functions (a bound field delegating to
// the module-level evaluator), so aliasing keeps every call site below unchanged.
const evaluateAutoscaleCandidate = new AutoscaleCandidateDetector().evaluate;
const evaluateAutoscaleToManualCandidate = new AutoscaleToManualCandidateDetector().evaluate;
const evaluateCrossPartitionQuery = new CrossPartitionQueryDetector().evaluate;
const evaluateExpensiveConsistency = new ExpensiveConsistencyDetector().evaluate;
const evaluateHotPartitionRisk = new HotPartitionRiskDetector().evaluate;
const evaluateIdleContainer = new IdleContainerDetector().evaluate;
const evaluateMultiRegionWrites = new MultiRegionWriteAntipatternDetector().evaluate;
const evaluateOverProvisioning = new OverProvisioningDetector().evaluate;
const evaluatePartitionMergeCandidate = new PartitionMergeCandidateDetector().evaluate;
const evaluateServerlessCandidate = new ServerlessCandidateDetector().evaluate;
const evaluateSharedThroughputStarvation = new SharedThroughputStarvationDetector().evaluate;
const evaluateShardKeyMisalignment = new ShardKeyMisalignmentDetector().evaluate;
const evaluateStorageGrowthRisk = new StorageGrowthRiskDetector().evaluate;
const evaluateStorageSkewRisk = new StorageSkewRiskDetector().evaluate;
const evaluateUncontrolledIngestion = new UncontrolledIngestionDetector().evaluate;
const evaluateUnderProvisioning = new UnderProvisioningDetector().evaluate;

const GIB = 1024 ** 3;
const DAY = 24 * 60 * 60 * 1000;

// Default thresholds shared with the production engine so the parity harness exercises the shipped constants.
const SATURATION_PCT = 90;
const HEADROOM_PCT = 70;
const THROTTLE_FLOOR_PCT = 1;

/** Per-container partition-saturation signal (DX-006 / DX-005 shape). */
function partInput(overrides: Partial<PartitionSaturationInput> = {}): PartitionSaturationInput {
    return {
        databaseId: 'db',
        containerId: 'c',
        maxP99: 95,
        minP99: 30,
        partitionCount: 4,
        throttleRatePercent: 0,
        totalRequests: 50_000,
        throughputMode: 'dedicated',
        provisionedRu: 1_000,
        ...overrides,
    };
}

/** Builds a physical-partition storage series from per-day sizes in GiB (day 0 → oldest). */
function storageSeries(partitionId: string, gibPerDay: number[]): ContainerStorageInput['partitions'][number] {
    return { partitionId, samples: gibPerDay.map((gib, day) => ({ timestamp: day * DAY, bytes: gib * GIB })) };
}

function storageContainer(partitions: ContainerStorageInput['partitions']): ContainerStorageInput {
    return { databaseId: 'db', containerId: 'c', partitions };
}

function idleInput(overrides: Partial<IdleContainerInput> = {}): IdleContainerInput {
    return {
        databaseId: 'db',
        containerId: 'c',
        peakRuPerBucket: 10,
        throughputMode: 'dedicated',
        provisionedRu: 1_000,
        ...overrides,
    };
}

function mergeInput(overrides: Partial<PartitionMergeInput> = {}): PartitionMergeInput {
    return {
        databaseId: 'db',
        containerId: 'c',
        actualPartitions: 4,
        provisionedRu: 10_000,
        dataUsageBytes: 0,
        ...overrides,
    };
}

function autoUtil(overrides: Partial<AutoscaleUtilizationInput> = {}): AutoscaleUtilizationInput {
    return {
        databaseId: 'db',
        containerId: 'c',
        peakPercent: 10,
        avgPercent: 5,
        sampleCount: 200,
        configuredMaxRu: 4_000,
        ...overrides,
    };
}

function serverlessInput(overrides: Partial<ServerlessCandidateInput> = {}): ServerlessCandidateInput {
    return { avgRuPerSec: 5, peakRuPerSec: 100, sampleCount: 30, isServerless: false, ...overrides };
}

const SERVERLESS_THRESHOLDS = {
    sporadicRatio: DEFAULT_ADVISORY_THRESHOLDS.serverlessSporadicRatio,
    peakFloorRuPerSec: DEFAULT_ADVISORY_THRESHOLDS.serverlessPeakFloorRuPerSec,
    peakCeilingRuPerSec: DEFAULT_ADVISORY_THRESHOLDS.serverlessPeakCeilingRuPerSec,
};

const DUTY_CYCLE: AutoscaleThresholds = { maxPercent: 40, avgPercent: 30, peakToAvgRatio: 5 };

function accountConfig(overrides: Partial<AccountConfigInput> = {}): AccountConfigInput {
    return {
        accountName: 'acct-prod',
        regionCount: 2,
        multiRegionWritesEnabled: false,
        writeRegionCount: 1,
        apiKind: 'core',
        ...overrides,
    };
}

// -------------------------------------------------------------------------------------------------
// DX-006 HotPartitionRisk — parity with coda/tests/test_hot_partition.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-006 HotPartitionRisk (test_hot_partition.py)', () => {
    it('low-count skew while throttling → High (test_low_count_skew_with_throttling_high)', () => {
        const v = evaluateHotPartitionRisk(
            partInput({ partitionCount: 2, maxP99: 100, minP99: 0, throttleRatePercent: 30 }),
            SATURATION_PCT,
            HEADROOM_PCT,
            THROTTLE_FLOOR_PCT,
        );
        expect(v?.rule).toBe('HotPartitionRisk');
        expect(v?.severity).toBe('High');
    });

    it('high-count skew fires (test_high_count_skew_fires)', () => {
        const v = evaluateHotPartitionRisk(
            partInput({ partitionCount: 10, maxP99: 100, minP99: 15, throttleRatePercent: 8 }),
            SATURATION_PCT,
            HEADROOM_PCT,
            THROTTLE_FLOOR_PCT,
        );
        expect(v?.rule).toBe('HotPartitionRisk');
        expect(v?.severity).toBe('High');
    });

    it('half-hot split still counts as skew (test_half_hot_still_skew)', () => {
        const v = evaluateHotPartitionRisk(
            partInput({ partitionCount: 10, maxP99: 95, minP99: 20, throttleRatePercent: 5 }),
            SATURATION_PCT,
            HEADROOM_PCT,
            THROTTLE_FLOOR_PCT,
        );
        expect(v?.rule).toBe('HotPartitionRisk');
    });

    it('saturated busiest, not yet throttling → Medium early warning (test_saturated_not_throttling_is_early_warning_medium)', () => {
        const v = evaluateHotPartitionRisk(
            partInput({ partitionCount: 2, maxP99: 100, minP99: 0, throttleRatePercent: 0 }),
            SATURATION_PCT,
            HEADROOM_PCT,
            THROTTLE_FLOOR_PCT,
        );
        expect(v?.severity).toBe('Medium');
    });

    it('uniform saturation routes away to DX-005 (test_uniform_saturation_routes_to_dx005)', () => {
        expect(
            evaluateHotPartitionRisk(
                partInput({ partitionCount: 2, maxP99: 95, minP99: 95, throttleRatePercent: 30 }),
                SATURATION_PCT,
                HEADROOM_PCT,
                THROTTLE_FLOOR_PCT,
            ),
        ).toBeUndefined();
    });

    it('coolest partition at the headroom cutoff is not skew (test_borderline_cool_partition_not_skew)', () => {
        expect(
            evaluateHotPartitionRisk(
                partInput({ partitionCount: 3, maxP99: 100, minP99: 75, throttleRatePercent: 20 }),
                SATURATION_PCT,
                HEADROOM_PCT,
                THROTTLE_FLOOR_PCT,
            ),
        ).toBeUndefined();
    });

    it('single partition cannot be skewed (test_single_partition_cannot_be_skewed)', () => {
        expect(
            evaluateHotPartitionRisk(
                partInput({ partitionCount: 1, maxP99: 95, minP99: 95, throttleRatePercent: 30 }),
                SATURATION_PCT,
                HEADROOM_PCT,
                THROTTLE_FLOOR_PCT,
            ),
        ).toBeUndefined();
    });

    it('nothing saturated → not flagged (test_not_saturated_not_flagged)', () => {
        expect(
            evaluateHotPartitionRisk(
                partInput({ partitionCount: 4, maxP99: 60, minP99: 10 }),
                SATURATION_PCT,
                HEADROOM_PCT,
                THROTTLE_FLOOR_PCT,
            ),
        ).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-005 SustainedThrottling / under-provisioning — parity with coda/tests/test_under_provisioning.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-005 UnderProvisioning (test_under_provisioning.py)', () => {
    it('not throttling → no finding (test_not_throttling)', () => {
        expect(
            evaluateUnderProvisioning(
                partInput({ maxP99: 40, minP99: 40, throttleRatePercent: 0.2 }),
                SATURATION_PCT,
                HEADROOM_PCT,
                THROTTLE_FLOOR_PCT,
            ),
        ).toBeUndefined();
    });

    it('uniform saturation + high 429 rate on manual → High (test_uniform_under_provisioned_manual)', () => {
        const v = evaluateUnderProvisioning(
            partInput({ partitionCount: 1, maxP99: 100, minP99: 95, throttleRatePercent: 25, provisionedRu: 400 }),
            SATURATION_PCT,
            HEADROOM_PCT,
            THROTTLE_FLOOR_PCT,
        );
        expect(v?.rule).toBe('SustainedThrottlingInRegion');
        expect(v?.severity).toBe('High');
    });

    it('uniform saturation + moderate 429 rate → Medium (test_uniform_under_provisioned_autoscale)', () => {
        const v = evaluateUnderProvisioning(
            partInput({
                partitionCount: 3,
                maxP99: 100,
                minP99: 90,
                throttleRatePercent: 8,
                throughputMode: 'autoscale',
                provisionedRu: 4_000,
            }),
            SATURATION_PCT,
            HEADROOM_PCT,
            THROTTLE_FLOOR_PCT,
        );
        expect(v?.severity).toBe('Medium');
    });

    it('skew suspected routes away to DX-006 (test_skew_suspected_routes_to_dx006)', () => {
        expect(
            evaluateUnderProvisioning(
                partInput({
                    partitionCount: 4,
                    maxP99: 100,
                    minP99: 10,
                    throttleRatePercent: 30,
                    provisionedRu: 10_000,
                }),
                SATURATION_PCT,
                HEADROOM_PCT,
                THROTTLE_FLOOR_PCT,
            ),
        ).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-001 OverProvisioning — parity with coda/tests/test_over_provisioning.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-001 OverProvisioning (test_over_provisioning.py)', () => {
    it('low utilisation on manual throughput is over-provisioned (test_classify_low_utilization_is_over_provisioned)', () => {
        const v = evaluateOverProvisioning(2, 2, 30, true, 1_000);
        expect(v?.rule).toBe('OverProvisioning');
    });

    // CODA's classify() grades over-provisioning severity on an absolute-RU basis when no scope is supplied
    // (test_classify_low_utilization_is_over_provisioned: 600 RU/s wasted → "low"). Our evaluateOverProvisioning
    // implements that absolute basis off the container's provisioned RU — more wasted capacity ⇒ higher severity.
    // CODA's *scope-relative* materiality flip (test_classify_materiality_flips_with_scope) is realised in our engine
    // through DX-004 IdleContainer's scopeProvisionedRuTotal, exercised in the IdleContainer parity block below.
    it('grades severity by absolute wasted capacity (test_classify_low_utilization_is_over_provisioned basis)', () => {
        expect(evaluateOverProvisioning(10, 10, 30, true, 100_000)?.severity).toBe('High');
        expect(evaluateOverProvisioning(10, 10, 30, true, 420)?.severity).toBe('Medium');
        expect(evaluateOverProvisioning(10, 10, 30, true, 402)?.severity).toBe('Low');
    });

    it('peak-saturation guard protects a bursty container (test_classify_bursty_not_flagged_saturation_guard)', () => {
        expect(evaluateOverProvisioning(2, 100, 30, true, 1_000)).toBeUndefined();
    });

    it('a saturating peak is left alone (test_classify_saturating_peak_recommends_full_capacity)', () => {
        expect(evaluateOverProvisioning(5, 95, 30, true, 1_000)).toBeUndefined();
    });

    it('a well-utilised container is in-band (test_classify_well_utilized_not_flagged)', () => {
        expect(evaluateOverProvisioning(50, 50, 30, true, 1_000)).toBeUndefined();
    });

    it('zero samples abstain (test_classify_zero_samples_abstains)', () => {
        expect(evaluateOverProvisioning(undefined, undefined, 30, true, 1_000)).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-012 manual→autoscale AutoscaleCandidate — parity with coda/tests/test_mode_switch.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-012 AutoscaleCandidate (test_mode_switch.py)', () => {
    it('spiky manual → recommend autoscale (test_spiky_manual_recommends_autoscale)', () => {
        const v = evaluateAutoscaleCandidate(64, 0.5, DUTY_CYCLE, true);
        expect(v?.rule).toBe('AutoscaleCandidate');
    });

    it('steady low manual is well matched (test_steady_low_manual_not_dx012)', () => {
        expect(evaluateAutoscaleCandidate(12, 8, DUTY_CYCLE, true)).toBeUndefined();
    });

    it('steady high manual has no idle to reclaim (test_steady_high_manual_not_dx012)', () => {
        expect(evaluateAutoscaleCandidate(95, 80, DUTY_CYCLE, true)).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-013 autoscale→manual AutoscaleToManualCandidate — parity with coda/tests/test_mode_switch.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-013 AutoscaleToManualCandidate (test_mode_switch.py)', () => {
    it('steady-high autoscale → recommend manual (test_steady_high_autoscale_recommends_manual)', () => {
        const v = evaluateAutoscaleToManualCandidate(autoUtil({ avgPercent: 80, peakPercent: 92 }), 66, 1.3);
        expect(v?.rule).toBe('AutoscaleToManualCandidate');
    });

    it('spiky autoscale stays autoscale (test_spiky_autoscale_stays_autoscale)', () => {
        expect(
            evaluateAutoscaleToManualCandidate(autoUtil({ avgPercent: 20, peakPercent: 90 }), 66, 1.3),
        ).toBeUndefined();
    });

    it('low-average autoscale is not a mode switch (test_low_autoscale_not_dx013)', () => {
        expect(
            evaluateAutoscaleToManualCandidate(autoUtil({ avgPercent: 20, peakPercent: 28 }), 66, 1.3),
        ).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-004 IdleContainer — parity with coda/tests/test_idle_container.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-004 IdleContainer (test_idle_container.py)', () => {
    it('active container is not idle (test_active_container_not_idle)', () => {
        expect(
            evaluateIdleContainer(idleInput({ peakRuPerBucket: 5_000, provisionedRu: 5_000 }), 50, 10_000),
        ).toBeUndefined();
    });

    it('idle manual container recovers the whole reservation (test_idle_manual_recovers_full_provisioned)', () => {
        const v = evaluateIdleContainer(idleInput({ peakRuPerBucket: 0, provisionedRu: 2_000 }), 50, 10_000);
        expect(v?.rule).toBe('IdleContainer');
        expect(v?.rationale).toContain('2000 RU/s');
    });

    it('idle at the floor is still flagged with savings (test_idle_at_floor_still_flagged_with_savings)', () => {
        const v = evaluateIdleContainer(idleInput({ peakRuPerBucket: 4, provisionedRu: 400 }), 50, 10_000);
        expect(v?.rule).toBe('IdleContainer');
    });

    it('idle autoscale recovers only the 10% idle floor (test_idle_autoscale_recovers_idle_floor)', () => {
        const v = evaluateIdleContainer(
            idleInput({ throughputMode: 'autoscale', provisionedRu: 10_000, peakRuPerBucket: 0 }),
            50,
            100_000,
        );
        expect(v?.rationale).toContain('1000 RU/s');
    });

    it('severity is scope-relative: small→High, fleet→Low (test_severity_is_scope_relative)', () => {
        const sig = idleInput({ peakRuPerBucket: 0, provisionedRu: 5_000 });
        expect(evaluateIdleContainer(sig, 50, 10_000)?.severity).toBe('High');
        expect(evaluateIdleContainer(sig, 50, 1_000_000)?.severity).toBe('Low');
    });

    it('a monthly batch spike is active, not idle (test_monthly_batch_spike_not_flagged_idle)', () => {
        expect(
            evaluateIdleContainer(idleInput({ peakRuPerBucket: 1_764, provisionedRu: 2_000 }), 50, 10_000),
        ).toBeUndefined();
    });

    it('idle-peak threshold boundary: at→idle, above→active (test_idle_threshold_boundary)', () => {
        expect(evaluateIdleContainer(idleInput({ peakRuPerBucket: 50 }), 50, 10_000)).toBeDefined();
        expect(evaluateIdleContainer(idleInput({ peakRuPerBucket: 51 }), 50, 10_000)).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-009 PartitionMergeCandidate — parity with coda/tests/test_partition_merge.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-009 PartitionMergeCandidate (test_partition_merge.py)', () => {
    it('over-partitioned ≥ 2× need → Medium (test_over_partitioned_fires)', () => {
        const v = evaluatePartitionMergeCandidate(
            mergeInput({ actualPartitions: 2, provisionedRu: 1_000, dataUsageBytes: Math.round(1.8 * GIB) }),
        );
        expect(v?.rule).toBe('PartitionMergeCandidate');
        expect(v?.severity).toBe('Medium');
    });

    it('over-partitioned but below 2× → Low (test_low_over_partition_is_low)', () => {
        const v = evaluatePartitionMergeCandidate(
            mergeInput({ actualPartitions: 3, provisionedRu: 15_000, dataUsageBytes: 1 * GIB }),
        );
        expect(v?.severity).toBe('Low');
    });

    it('right-sized container is not flagged (test_right_sized_not_flagged)', () => {
        expect(
            evaluatePartitionMergeCandidate(
                mergeInput({ actualPartitions: 3, provisionedRu: 25_000, dataUsageBytes: 120 * GIB }),
            ),
        ).toBeUndefined();
    });

    it('single partition is never flagged (test_single_partition_not_flagged)', () => {
        expect(
            evaluatePartitionMergeCandidate(mergeInput({ actualPartitions: 1, provisionedRu: 1_000 })),
        ).toBeUndefined();
    });

    it('no partitions abstains (test_no_partitions_insufficient)', () => {
        expect(
            evaluatePartitionMergeCandidate(mergeInput({ actualPartitions: 0, provisionedRu: 1_000 })),
        ).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-014 ServerlessCandidate — parity with coda/tests/test_serverless_candidate.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-014 ServerlessCandidate (test_serverless_candidate.py)', () => {
    it('low, sporadic account-total shape is a candidate (test_low_sporadic_is_candidate)', () => {
        const v = evaluateServerlessCandidate(
            serverlessInput({ avgRuPerSec: 5, peakRuPerSec: 100 }),
            SERVERLESS_THRESHOLDS,
        );
        expect(v?.rule).toBe('ServerlessCandidate');
        expect(v?.severity).toBe('Low');
    });

    it('steady load is not sporadic (test_steady_load_not_candidate)', () => {
        expect(
            evaluateServerlessCandidate(serverlessInput({ avgRuPerSec: 50, peakRuPerSec: 100 }), SERVERLESS_THRESHOLDS),
        ).toBeUndefined();
    });

    it('near-idle account is decommission territory, not serverless (test_idle_account_not_candidate)', () => {
        expect(
            evaluateServerlessCandidate(serverlessInput({ avgRuPerSec: 0.1, peakRuPerSec: 3 }), SERVERLESS_THRESHOLDS),
        ).toBeUndefined();
    });

    it('peak above the single-partition ceiling steers away (test_high_peak_exceeds_serverless)', () => {
        expect(
            evaluateServerlessCandidate(
                serverlessInput({ avgRuPerSec: 100, peakRuPerSec: 8_000 }),
                SERVERLESS_THRESHOLDS,
            ),
        ).toBeUndefined();
    });

    it('an account already on serverless is never a candidate (test_already_serverless_guard)', () => {
        expect(
            evaluateServerlessCandidate(serverlessInput({ isServerless: true }), SERVERLESS_THRESHOLDS),
        ).toBeUndefined();
    });

    it('insufficient history abstains (test_insufficient_history)', () => {
        expect(
            evaluateServerlessCandidate(serverlessInput({ sampleCount: 10 }), SERVERLESS_THRESHOLDS),
        ).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-017 StorageGrowthRisk — parity with coda/tests/test_storage_growth.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-017 StorageGrowthRisk (test_storage_growth.py)', () => {
    it('fast growth to the ceiling is High (test_fast_growth_to_limit_is_high)', () => {
        const v = evaluateStorageGrowthRisk(storageContainer([storageSeries('0', [41, 42, 43, 44])]), 180);
        expect(v?.rule).toBe('StorageGrowthRisk');
        expect(v?.severity).toBe('High');
    });

    it('a medium horizon grades Medium (test_medium_horizon)', () => {
        const v = evaluateStorageGrowthRisk(storageContainer([storageSeries('0', [28.5, 29, 29.5, 30])]), 180);
        expect(v?.severity).toBe('Medium');
    });

    it('slow growth below the rate floor is stable (test_slow_growth_stable)', () => {
        expect(
            evaluateStorageGrowthRisk(storageContainer([storageSeries('0', [45, 45, 45, 45])]), 180),
        ).toBeUndefined();
    });

    it('a too-small partition is not flagged (test_too_small_partition)', () => {
        expect(
            evaluateStorageGrowthRisk(storageContainer([storageSeries('0', [0.1, 0.2, 0.3, 0.5])]), 180),
        ).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-015 StorageSkewRisk — parity with coda/tests/test_storage_skew.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-015 StorageSkewRisk (test_storage_skew.py)', () => {
    it('imbalanced but small is a Low early warning (test_imbalanced_small_is_low_early_warning)', () => {
        const v = evaluateStorageSkewRisk(storageContainer([storageSeries('0', [2]), storageSeries('1', [0.2])]), 0.7);
        expect(v?.rule).toBe('StorageSkewRisk');
        expect(v?.severity).toBe('Low');
    });

    it('imbalanced mid-size is Medium (test_imbalanced_mid_is_medium)', () => {
        const v = evaluateStorageSkewRisk(storageContainer([storageSeries('0', [30]), storageSeries('1', [5])]), 0.7);
        expect(v?.severity).toBe('Medium');
    });

    it('imbalanced near the ceiling is High (test_imbalanced_near_ceiling_is_high)', () => {
        const v = evaluateStorageSkewRisk(storageContainer([storageSeries('0', [45]), storageSeries('1', [5])]), 0.7);
        expect(v?.severity).toBe('High');
    });

    it('high partition count with one large partition fires High (test_high_count_skew_fires)', () => {
        const partitions = [
            storageSeries('big', [40]),
            ...[1, 2, 3, 4, 5, 6, 7].map((i) => storageSeries(`p${i}`, [1])),
        ];
        const v = evaluateStorageSkewRisk(storageContainer(partitions), 0.7);
        expect(v?.severity).toBe('High');
    });

    it('a balanced large split is uniform — no finding (test_balanced_large_is_uniform_no_finding)', () => {
        expect(
            evaluateStorageSkewRisk(storageContainer([storageSeries('0', [45]), storageSeries('1', [44])]), 0.7),
        ).toBeUndefined();
    });

    it('a too-small busiest partition is immaterial (test_too_small_not_flagged)', () => {
        expect(
            evaluateStorageSkewRisk(storageContainer([storageSeries('0', [0.5]), storageSeries('1', [0.01])]), 0.7),
        ).toBeUndefined();
    });

    it('a single partition cannot be skewed (test_single_partition_cannot_be_skewed)', () => {
        expect(evaluateStorageSkewRisk(storageContainer([storageSeries('0', [45])]), 0.7)).toBeUndefined();
    });

    it('coolest at the balance floor is uniform (test_borderline_balance_floor_not_skew)', () => {
        expect(
            evaluateStorageSkewRisk(storageContainer([storageSeries('0', [40]), storageSeries('1', [28])]), 0.7),
        ).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-016 ExpensiveConsistency — parity with coda/tests/test_consistency.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-016 ExpensiveConsistency (test_consistency.py)', () => {
    it('Session is not expensive (test_session_not_expensive)', () => {
        expect(
            evaluateExpensiveConsistency(accountConfig({ consistencyLevel: 'Session', regionCount: 2 })),
        ).toBeUndefined();
    });

    it('Strong across ≥ 2 regions is Medium (test_strong_multi_region_is_medium)', () => {
        const v = evaluateExpensiveConsistency(accountConfig({ consistencyLevel: 'Strong', regionCount: 2 }));
        expect(v?.rule).toBe('ExpensiveConsistency');
        expect(v?.severity).toBe('Medium');
    });

    it('Bounded Staleness across ≥ 2 regions is Low (test_bounded_staleness_multi_region_is_low)', () => {
        const v = evaluateExpensiveConsistency(accountConfig({ consistencyLevel: 'BoundedStaleness', regionCount: 3 }));
        expect(v?.severity).toBe('Low');
    });

    it('Strong on a single region is not flagged (test_strong_single_region_not_flagged)', () => {
        expect(
            evaluateExpensiveConsistency(accountConfig({ consistencyLevel: 'Strong', regionCount: 1 })),
        ).toBeUndefined();
    });

    it('an enum-style level is normalised (test_enum_style_value_normalized)', () => {
        const v = evaluateExpensiveConsistency(
            accountConfig({ consistencyLevel: 'ConsistencyLevel.Strong', regionCount: 2 }),
        );
        expect(v?.severity).toBe('Medium');
    });

    it('an unknown level abstains (test_unknown_level)', () => {
        expect(
            evaluateExpensiveConsistency(accountConfig({ consistencyLevel: undefined, regionCount: 2 })),
        ).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------------
// DX-008 MultiRegionWriteAntipattern — parity with coda/tests/test_multi_region_write.py
// -------------------------------------------------------------------------------------------------

describe('CODA parity — DX-008 MultiRegionWriteAntipattern (test_multi_region_write.py)', () => {
    it('multi-region writes off is not flagged (test_multi_region_writes_off_not_flagged)', () => {
        expect(evaluateMultiRegionWrites(accountConfig({ multiRegionWritesEnabled: false }))).toBeUndefined();
    });

    it('Mongo multi-region writes is High (test_mongo_multi_region_writes_is_high)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'payments-prod',
                apiKind: 'mongo',
                multiRegionWritesEnabled: true,
                writeRegionCount: 2,
            }),
        );
        expect(v?.severity).toBe('High');
    });

    it('production multi-region writes is legitimate HA (test_prod_multi_region_writes_is_legitimate)', () => {
        expect(
            evaluateMultiRegionWrites(
                accountConfig({ accountName: 'payments', multiRegionWritesEnabled: true, writeRegionCount: 2 }),
            ),
        ).toBeUndefined();
    });

    it('non-production with ≥ 2 write regions is Medium (test_nonprod_multi_region_writes_two_regions_is_medium)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({ accountName: 'payments-test', multiRegionWritesEnabled: true, writeRegionCount: 2 }),
        );
        expect(v?.severity).toBe('Medium');
    });

    it('single write region is a Low tripwire (test_nonprod_multi_region_writes_single_region_is_low_tripwire)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'payments-dev',
                multiRegionWritesEnabled: true,
                writeRegionCount: 1,
                regionCount: 1,
            }),
        );
        expect(v?.severity).toBe('Low');
    });

    it('production single write region is the same tripwire (test_prod_single_region_multi_region_writes_is_tripwire)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'payments-prod',
                multiRegionWritesEnabled: true,
                writeRegionCount: 1,
                regionCount: 1,
            }),
        );
        expect(v?.severity).toBe('Low');
    });

    it('Cassandra multi-region writes is High wrong-API (test_cassandra_multi_region_writes_is_high_wrong_api)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'ledger-prod',
                apiKind: 'cassandra',
                multiRegionWritesEnabled: true,
                writeRegionCount: 2,
            }),
        );
        expect(v?.severity).toBe('High');
    });

    it('Gremlin multi-region writes is High wrong-API (test_gremlin_multi_region_writes_is_high_wrong_api)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'graph-prod',
                apiKind: 'gremlin',
                multiRegionWritesEnabled: true,
                writeRegionCount: 2,
            }),
        );
        expect(v?.severity).toBe('High');
    });

    it('Table multi-region writes is High wrong-API (test_table_multi_region_writes_is_high_wrong_api)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'kv-prod',
                apiKind: 'table',
                multiRegionWritesEnabled: true,
                writeRegionCount: 2,
            }),
        );
        expect(v?.severity).toBe('High');
    });

    it('an explicit production tag overrides a non-prod name token (test_env_tag_production_overrides_name_token)', () => {
        expect(
            evaluateMultiRegionWrites(
                accountConfig({
                    accountName: 'dev-platform',
                    multiRegionWritesEnabled: true,
                    writeRegionCount: 2,
                    tags: { environment: 'Production' },
                }),
            ),
        ).toBeUndefined();
    });

    it('a QA tag marks the account non-production (test_env_tag_qa_marks_non_prod)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'platform',
                multiRegionWritesEnabled: true,
                writeRegionCount: 2,
                tags: { env: 'qa' },
            }),
        );
        expect(v?.severity).toBe('Medium');
    });

    it('a non-prod subscription name classifies the account (test_is_non_production_via_subscription_name)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'payments',
                multiRegionWritesEnabled: true,
                writeRegionCount: 2,
                subscriptionName: 'ACME-Dev-Sandbox',
            }),
        );
        expect(v?.severity).toBe('Medium');
    });

    it('a prod name containing a non-prod substring is not a false positive (test_substring_false_positive_avoided)', () => {
        expect(
            evaluateMultiRegionWrites(
                accountConfig({ accountName: 'stagecoach-prod', multiRegionWritesEnabled: true, writeRegionCount: 2 }),
            ),
        ).toBeUndefined();
    });

    it('Mongo classification precedes the env-based variants (test_mongo_non_prod_still_high)', () => {
        const v = evaluateMultiRegionWrites(
            accountConfig({
                accountName: 'cache-dev',
                apiKind: 'mongo',
                multiRegionWritesEnabled: true,
                writeRegionCount: 1,
                regionCount: 1,
            }),
        );
        expect(v?.severity).toBe('High');
    });
});

// ─── DX-002 CrossPartitionQuery (coda/tests/test_cross_partition_query.py) ────────

const CP_THRESHOLDS = {
    minQueries: DEFAULT_ADVISORY_THRESHOLDS.crossPartitionMinQueries,
    fanoutThreshold: DEFAULT_ADVISORY_THRESHOLDS.crossPartitionFanoutThreshold,
    highPct: DEFAULT_ADVISORY_THRESHOLDS.crossPartitionHighPct,
    medPct: DEFAULT_ADVISORY_THRESHOLDS.crossPartitionMedPct,
};

function shape(text: string, executions: number, avgFanout: number, maxFanout: number): QueryShapeInput {
    return { text, executions, avgFanout, maxFanout };
}

function cpInput(shapes: QueryShapeInput[]): CrossPartitionInput {
    return { databaseId: 'db', containerId: 'c', shapes };
}

describe('DX-002 cross-partition query fan-out parity', () => {
    it('flags High when the dominant share of executions fans out', () => {
        const v = evaluateCrossPartitionQuery(
            cpInput([
                shape('SELECT * FROM c WHERE c.email=@e', 800, 2.0, 2),
                shape('SELECT * FROM c WHERE c.pk=@p', 200, 1.0, 1),
            ]),
            CP_THRESHOLDS,
        );
        expect(v?.rule).toBe('CrossPartitionQuery');
        expect(v?.severity).toBe('High'); // 80% cross
        expect(v?.scope).toBe('db/c');
        expect(v?.rationale).toContain('email');
    });

    it('flags Medium at a moderate cross-partition share', () => {
        const v = evaluateCrossPartitionQuery(
            cpInput([
                shape('SELECT * FROM c WHERE c.email=@e', 150, 2.0, 2),
                shape('SELECT * FROM c WHERE c.pk=@p', 850, 1.0, 1),
            ]),
            CP_THRESHOLDS,
        );
        expect(v?.severity).toBe('Medium'); // 15% cross
    });

    it('does not flag a mostly single-partition workload', () => {
        const v = evaluateCrossPartitionQuery(
            cpInput([
                shape('SELECT * FROM c WHERE c.email=@e', 30, 2.0, 2),
                shape('SELECT * FROM c WHERE c.pk=@p', 970, 1.0, 1),
            ]),
            CP_THRESHOLDS,
        );
        expect(v).toBeUndefined(); // 3% < med floor
    });

    it('does not flag a single-partition container (cannot fan out)', () => {
        const v = evaluateCrossPartitionQuery(cpInput([shape('SELECT * FROM c', 500, 1.0, 1)]), CP_THRESHOLDS);
        expect(v).toBeUndefined();
    });

    it('abstains on insufficient query volume', () => {
        const v = evaluateCrossPartitionQuery(
            cpInput([shape('SELECT * FROM c WHERE c.email=@e', 10, 2.0, 2)]),
            CP_THRESHOLDS,
        );
        expect(v).toBeUndefined();
    });
});

// ─── DX-007 ShardKeyMisalignment (coda/tests/test_shard_key_misalignment.py) ──────

const SHARD_THRESHOLDS = {
    structuralPct: DEFAULT_ADVISORY_THRESHOLDS.shardKeyStructuralPct,
    minPartitions: 2,
    highPct: DEFAULT_ADVISORY_THRESHOLDS.shardKeyHighPct,
};
const CP_FANOUT = DEFAULT_ADVISORY_THRESHOLDS.crossPartitionFanoutThreshold;

function shardRows(crossExec: number, singleExec: number): CrossPartitionInput {
    return cpInput([
        shape("SELECT * FROM c WHERE c.p1 != 'str1'", crossExec, 2.0, 2),
        shape('SELECT * FROM c WHERE c.p1 = @param1', singleExec, 1.0, 1),
    ]);
}

describe('DX-007 shard-key misalignment parity', () => {
    it('flags High when the dominant share fans out (≥ 80%)', () => {
        const v = evaluateShardKeyMisalignment(shardRows(850, 150), SHARD_THRESHOLDS, CP_FANOUT);
        expect(v?.rule).toBe('ShardKeyMisalignment');
        expect(v?.severity).toBe('High');
        expect(v?.suggestedAction.toLowerCase()).toContain('re-key');
    });

    it('flags Medium at a moderate-dominant share ([60,80))', () => {
        const v = evaluateShardKeyMisalignment(shardRows(650, 350), SHARD_THRESHOLDS, CP_FANOUT);
        expect(v?.severity).toBe('Medium');
    });

    it('does not flag a per-query-only problem (< structural share)', () => {
        const v = evaluateShardKeyMisalignment(shardRows(150, 850), SHARD_THRESHOLDS, CP_FANOUT);
        expect(v).toBeUndefined();
    });

    it('does not flag a single-partition container', () => {
        const v = evaluateShardKeyMisalignment(
            cpInput([shape('SELECT * FROM c', 500, 1.0, 1)]),
            SHARD_THRESHOLDS,
            CP_FANOUT,
        );
        expect(v).toBeUndefined();
    });

    it('requires the configured minimum physical partitions', () => {
        const v = evaluateShardKeyMisalignment(
            shardRows(850, 150),
            { ...SHARD_THRESHOLDS, minPartitions: 3 },
            CP_FANOUT,
        );
        expect(v).toBeUndefined(); // container only spans 2 partitions
    });
});

// ─── DX-010 UncontrolledIngestion (coda/tests/test_uncontrolled_ingestion.py) ─────

const ING_THRESHOLDS = {
    writeRuPctFloor: DEFAULT_ADVISORY_THRESHOLDS.ingestionWriteRuPctFloor,
    throttleRatePct: DEFAULT_ADVISORY_THRESHOLDS.ingestionThrottleRatePct,
    highPct: DEFAULT_ADVISORY_THRESHOLDS.ingestionHighPct,
    minRequests: DEFAULT_ADVISORY_THRESHOLDS.ingestionMinRequests,
};

function ingInput(overrides: Partial<UncontrolledIngestionInput>): UncontrolledIngestionInput {
    return {
        databaseId: 'db',
        containerId: 'c',
        writeRu: 0,
        totalRu: 0,
        totalRequests: 0,
        throttledRequests: 0,
        burstFactor: 0,
        ...overrides,
    };
}

describe('DX-010 uncontrolled ingestion parity', () => {
    it('flags High for write-dominant throttling (≥ 20% 429)', () => {
        const v = evaluateUncontrolledIngestion(
            ingInput({
                writeRu: 950_000,
                totalRu: 1_000_000,
                totalRequests: 300_000,
                throttledRequests: 75_000,
                burstFactor: 6.0,
                dominantUserAgent: 'spark-connector',
            }),
            ING_THRESHOLDS,
        );
        expect(v?.rule).toBe('UncontrolledIngestion');
        expect(v?.severity).toBe('High'); // 25% throttle
        expect(v?.suggestedAction.toLowerCase()).toContain('rate control');
        expect(v?.rationale).toContain('spark-connector');
    });

    it('flags Medium below the high 429 band', () => {
        const v = evaluateUncontrolledIngestion(
            ingInput({
                writeRu: 900_000,
                totalRu: 1_000_000,
                totalRequests: 300_000,
                throttledRequests: 42_000,
                burstFactor: 3.0,
            }),
            ING_THRESHOLDS,
        );
        expect(v?.severity).toBe('Medium'); // 14% throttle
    });

    it('does not flag a read-dominant workload', () => {
        const v = evaluateUncontrolledIngestion(
            ingInput({
                writeRu: 100_000,
                totalRu: 1_000_000,
                totalRequests: 300_000,
                throttledRequests: 60_000,
                burstFactor: 2.0,
            }),
            ING_THRESHOLDS,
        );
        expect(v).toBeUndefined();
    });

    it('does not flag write-dominant but not throttling', () => {
        const v = evaluateUncontrolledIngestion(
            ingInput({
                writeRu: 950_000,
                totalRu: 1_000_000,
                totalRequests: 300_000,
                throttledRequests: 600,
                burstFactor: 1.5,
            }),
            ING_THRESHOLDS,
        );
        expect(v).toBeUndefined();
    });

    it('abstains on insufficient requests', () => {
        const v = evaluateUncontrolledIngestion(
            ingInput({ writeRu: 950, totalRu: 1_000, totalRequests: 200, throttledRequests: 100, burstFactor: 5.0 }),
            ING_THRESHOLDS,
        );
        expect(v).toBeUndefined();
    });
});

// ─── DX-003 SharedThroughputStarvation (coda/tests/test_shared_throughput.py) ─────

const SHARED_THRESHOLDS = {
    minRequests: DEFAULT_ADVISORY_THRESHOLDS.sharedThroughputMinRequests,
    poolThrottlePct: DEFAULT_ADVISORY_THRESHOLDS.sharedThroughputPoolThrottlePct,
    dominancePct: DEFAULT_ADVISORY_THRESHOLDS.sharedThroughputDominancePct,
    victimThrottlePct: DEFAULT_ADVISORY_THRESHOLDS.sharedThroughputVictimThrottlePct,
    victimSharePct: DEFAULT_ADVISORY_THRESHOLDS.sharedThroughputVictimSharePct,
};

function coll(
    containerId: string,
    requests: number,
    throttledRequests: number,
    ruConsumed: number,
): CollectionTrafficInput {
    return { containerId, requests, throttledRequests, ruConsumed };
}

describe('DX-003 shared-throughput starvation parity', () => {
    it('fires when one collection monopolizes the pool and a sibling is starved', () => {
        const v = evaluateSharedThroughputStarvation(
            {
                databaseId: 'shareddb',
                sharedRu: 1000,
                collections: [coll('hot', 10000, 500, 900000), coll('cold', 1000, 300, 50000)],
            },
            SHARED_THRESHOLDS,
        );
        expect(v?.rule).toBe('SharedThroughputStarvation');
        expect(v?.severity).toBe('High');
        expect(v?.scope).toBe('shareddb');
        expect(v?.rationale).toContain('hot');
        expect(v?.rationale).toContain('cold');
    });

    it('does not fire when the pool is not throttling', () => {
        const v = evaluateSharedThroughputStarvation(
            {
                databaseId: 'shareddb',
                sharedRu: 1000,
                collections: [coll('a', 10000, 50, 600000), coll('b', 8000, 40, 400000)],
            },
            SHARED_THRESHOLDS,
        );
        expect(v).toBeUndefined();
    });

    it('does not fire on balanced throttling (no monopolizer)', () => {
        const v = evaluateSharedThroughputStarvation(
            {
                databaseId: 'shareddb',
                sharedRu: 1000,
                collections: [coll('a', 10000, 800, 520000), coll('b', 10000, 700, 480000)],
            },
            SHARED_THRESHOLDS,
        );
        expect(v).toBeUndefined();
    });

    it('does not fire when only one collection is active', () => {
        const v = evaluateSharedThroughputStarvation(
            {
                databaseId: 'shareddb',
                sharedRu: 1000,
                collections: [coll('solo', 10000, 900, 900000), coll('idle', 5, 0, 10)],
            },
            SHARED_THRESHOLDS,
        );
        expect(v).toBeUndefined();
    });

    it('does not fire when the dominant collection has no throttled victim', () => {
        const v = evaluateSharedThroughputStarvation(
            {
                databaseId: 'shareddb',
                sharedRu: 1000,
                collections: [coll('hot', 10000, 900, 950000), coll('cold', 1000, 5, 50000)],
            },
            SHARED_THRESHOLDS,
        );
        expect(v).toBeUndefined();
    });
});
