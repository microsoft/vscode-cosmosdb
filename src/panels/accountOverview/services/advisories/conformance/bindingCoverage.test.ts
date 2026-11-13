/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import { crossPartitionQueryDetector } from '../detectors/CrossPartitionQueryDetector';
import { multiRegionWriteAntipatternDetector } from '../detectors/MultiRegionWriteAntipatternDetector';
import { paidContinuousBackupDetector } from '../detectors/PaidContinuousBackupDetector';
import { partitionMergeCandidateDetector } from '../detectors/PartitionMergeCandidateDetector';
import { storageGrowthRiskDetector } from '../detectors/StorageGrowthRiskDetector';
import { GIB } from '../detectors/storageMath';
import { executeCase, SUPPORTED_DETECTORS } from './bindings';
import { parseFeature } from './features';

const fixtures = [
    [
        '002',
        'a container with 10000 queries that all fan out across 8 physical partitions in a 2 hour window',
        'cross_partition',
        'High',
    ],
    [
        '003',
        `a shared database with 5000 RU/s
    And collection "worker" has 1200 requests, 200 throttled and 9900 RU consumed
    And collection "site" has 1000 requests, 200 throttled and 100 RU consumed`,
        'starvation',
        'High',
    ],
    ['004', 'a manual container with 1200 RU/s that consumed at most 2 RU in any bucket', 'idle', 'Medium'],
    [
        '005',
        `a manual container with 12000 requests of which 3000 were throttled
    And its partitions peak at 98 and 88 percent utilization`,
        'global_under_provisioning',
        'High',
    ],
    [
        '006',
        `a container with 12000 requests of which 3000 were throttled
    And its partitions peak at 98 and 20 percent utilization`,
        'hot_partition',
        'High',
    ],
    [
        '007',
        'a container with 10000 queries that all fan out across 8 physical partitions in a 2 hour window',
        'shard_key_misaligned',
        'High',
    ],
    [
        '008',
        'an account using the mongo API with multi-region writes across 2 write regions',
        'mongo_multi_region_writes',
        'High',
    ],
    [
        '009',
        `a container with 20000 RU/s provisioned and 4 GiB of data on 9 physical partitions
    And the account backup policy is Continuous`,
        'over_partitioned',
        'Medium',
    ],
    [
        '010',
        `a container with 12000 requests of which 3000 were throttled
    And writes consumed 95 of 100 RU`,
        'uncontrolled_ingestion',
        'High',
    ],
    [
        '012',
        'a manual container with 32 samples averaging 8 percent and peaking at 48 percent',
        'spiky_manual',
        'Medium',
    ],
    [
        '013',
        'an autoscale container with a 12000 RU/s max and 32 samples averaging 75 percent and peaking at 88 percent',
        'steady_autoscale',
        'Medium',
    ],
    ['014', 'an account with 32 hourly samples at 2 RU/s and one peak of 200 RU/s', 'serverless_candidate', 'Low'],
    ['015', 'a container whose partitions hold 35,2 GiB', 'storage_skew', 'Medium'],
    [
        '016',
        `the default consistency is Bounded_staleness
    And the account spans 4 regions`,
        'premium_multi_region',
        'Low',
    ],
    ['017', 'the busiest partition holds 42 GiB and grows 2 GiB per day', 'rapid_growth', 'High'],
    ['018', 'a serverless container with 2000 requests of which 200 were throttled', 'serverless_throttling', 'Medium'],
    [
        '019',
        `a non-production account
    And the backup policy is Continuous with tier Continuous35Days`,
        'nonprod_paid_continuous_backup',
        'Medium',
    ],
    [
        '021',
        `5000 requests of which 1000 were throttled
    And 900 throttled Query operations
    And 100 throttled Read operations`,
        'decomposed',
        'High',
    ],
    ['022', 'the account spans 4 regions', 'prpa_candidate', 'Low'],
    ['023', 'an account provisioning 6000 RU/s', 'reserved_candidate', 'Low'],
    [
        '024',
        `a container with 45 GiB of index and 90 GiB of data
    And the indexing policy excludes 4 user paths`,
        'high_index_ratio',
        'Low',
    ],
] as const;

function scenario(detector: string, given: string, then: string, action = `evaluates DX-${detector}`) {
    return parseFeature(
        `
Feature: Synthetic adapter regression
  Scenario: Independently authored native observations
    Given ${given}
    When CODA ${action}
    Then ${then}
`,
        `dx${detector}_synthetic.feature`,
    )[0];
}

describe('all native CODA adapters without private-source access', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers precisely the 24 original detector identifiers', () => {
        expect([...SUPPORTED_DETECTORS].sort()).toEqual(
            Array.from({ length: 24 }, (_, index) => `DX-${String(index + 1).padStart(3, '0')}`),
        );
    });

    it.each(['container', 'shared database'])(
        'uses scope-relative materiality in both DX-011 evaluation paths for an autoscale %s',
        async (scope) => {
            const testCase = scenario(
                '011',
                `an autoscale ${scope} with a 10000 RU/s max whose peak total is 1000 RU/s over 720 samples
    And the container was created 60 days before the window ended
    And the scope provisions 10000 RU/s in total`,
                'the severity is High',
            );
            expect(await executeCase(testCase)).toBe(1);
        },
    );

    it.each(fixtures)(
        'executes DX-%s and rejects an incorrect root classification',
        async (detector, given, root, severity) => {
            const testCase = scenario(
                detector,
                given,
                `the root cause is ${root}\n    And the severity is ${severity}`,
            );
            expect(await executeCase(testCase)).toBe(2);
            const wrong = scenario(detector, given, 'the root cause is impossible_root');
            await expect(executeCase(wrong)).rejects.toThrow();
        },
    );

    it('exercises the Serverless capacity exclusion with otherwise quantifiable manual throughput', async () => {
        const evaluate = vi.spyOn(multiRegionWriteAntipatternDetector, 'evaluateResult');
        const testCase = scenario(
            '008',
            `an account using the sql API with multi-region writes across 2 write regions
    And a serverless account`,
            'the regional capacity evidence is unavailable',
        );

        expect(await executeCase(testCase)).toBe(1);
        expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ isServerless: true }), 1000);
    });

    it.each([0, 1, 3])('retains at least one configured region for %i write regions', async (writeRegions) => {
        const evaluate = vi.spyOn(multiRegionWriteAntipatternDetector, 'evaluateResult');
        const regionCount = Math.max(writeRegions, 1);
        const testCase = scenario(
            '008',
            `an account using the sql API with multi-region writes across ${writeRegions} write regions
    And manual throughput offers of 600 and 400 RU/s`,
            `the global regional footprint is ${1000 * regionCount} RU/s`,
        );

        expect(await executeCase(testCase)).toBe(1);
        expect(evaluate).toHaveBeenCalledWith(
            expect.objectContaining({ writeRegionCount: writeRegions, regionCount }),
            1000,
        );
    });

    it('exercises unsettled migration with a known Periodic policy rather than an already unknown policy', async () => {
        const evaluate = vi.spyOn(partitionMergeCandidateDetector, 'evaluateResult');
        const testCase = scenario(
            '009',
            `a container with 24000 RU/s provisioned and 6 GiB of data on 10 physical partitions
    And a backup-policy migration to Continuous is in progress`,
            `merge eligibility is unknown
    And no instruction to merge partitions is emitted`,
        );

        expect(await executeCase(testCase)).toBe(2);
        expect(evaluate).toHaveBeenCalledWith(
            expect.objectContaining({
                backupPolicy: {
                    type: 'Periodic',
                    migrationState: { status: 'InProgress', targetType: 'Continuous' },
                },
            }),
        );
    });

    it.each(['first', 'last'])('preserves both storage histories with the full partition %s', async (order) => {
        const evaluate = vi.spyOn(storageGrowthRiskDetector, 'evaluateResult');
        const testCase = scenario(
            '017',
            `a container with a partition at 50 GiB and another partition growing quickly
    And the full partition is listed ${order}`,
            'the root cause is at_or_over_limit',
            'reads the partition sizes for DX-017',
        );

        expect(await executeCase(testCase)).toBe(1);
        const histories = evaluate.mock.calls[0][0].partitions.map((partition) =>
            partition.samples.map(({ bytes }) => bytes / GIB),
        );
        const expected = [Array<number>(10).fill(50), Array.from({ length: 10 }, (_, index) => 2 * (index + 1))];
        expect(histories).toEqual(order === 'first' ? expected : expected.reverse());
    });

    it('distinguishes a missing continuous retention tier from an unrecognized tier string', async () => {
        const evaluate = vi.spyOn(paidContinuousBackupDetector, 'evaluateResult');
        const testCase = scenario(
            '019',
            `a non-production account
    And the backup policy is Continuous with tier none`,
            'the root cause is unknown_continuous_tier',
        );

        expect(await executeCase(testCase)).toBe(1);
        expect(evaluate).toHaveBeenCalledWith(
            expect.objectContaining({ backupPolicy: { type: 'Continuous', continuousTier: undefined } }),
        );
    });

    it('retains the declared daily evaluation window for empty query telemetry', async () => {
        const evaluate = vi.spyOn(crossPartitionQueryDetector, 'evaluateResult');

        expect(
            await executeCase(
                scenario('002', 'a container with no query telemetry', 'the root cause is insufficient_data'),
            ),
        ).toBe(1);
        expect(evaluate).toHaveBeenCalledWith(
            expect.objectContaining({ shapes: [], evaluationWindowSeconds: 86_400 }),
            expect.any(Object),
        );
    });

    it.each(['002', '003', '007', '010'])('DX-%s distinguishes a genuine log acquisition failure', async (detector) => {
        const given =
            detector === '003'
                ? 'a shared database with 5000 RU/s\n    And the Log Analytics query fails'
                : 'the Log Analytics query fails';
        const root = detector === '002' || detector === '007' ? 'log_analytics_unavailable' : 'query_error';
        expect(await executeCase(scenario(detector, given, `the root cause is ${root}`))).toBe(1);
    });

    it('classifies successful empty idle telemetry and measured zero as idle', async () => {
        const missing = scenario(
            '004',
            'a manual container with 1200 RU/s and no consumption telemetry',
            'the root cause is idle',
        );
        const zero = scenario(
            '004',
            'a manual container with 1200 RU/s that consumed at most 0 RU in any bucket',
            'the root cause is idle',
        );
        expect(await executeCase(missing)).toBe(1);
        expect(await executeCase(zero)).toBe(1);
    });

    it.each([
        ['a manual offer at database level', 'DX-004 applies to it'],
        ['the serverless detection set', 'DX-004 is not in it'],
    ])('evaluates actual applicability without inventing a When step: %s', async (given, then) => {
        const [testCase] = parseFeature(
            `
Feature: Synthetic applicability regression
  Scenario: Production applicability predicate
    Given ${given}
    Then ${then}
`,
            'dx004_synthetic.feature',
        );
        expect(await executeCase(testCase)).toBe(1);
    });
});
