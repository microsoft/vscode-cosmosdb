/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, expectTypeOf, it } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import { DEFAULT_ADVISORY_THRESHOLDS } from './core/thresholds';
import {
    type AdvisoryEvaluation,
    type ConsistencyReadRuInput,
    type CrossPartitionInput,
    type DerivedAdvisoryInputs,
} from './core/types';
import { AutoscaleMaxOverProvisionedDetector } from './detectors/AutoscaleMaxOverProvisionedDetector';
import { CrossPartitionQueryDetector } from './detectors/CrossPartitionQueryDetector';
import { ExpensiveConsistencyDetector } from './detectors/ExpensiveConsistencyDetector';
import { IndexingCostRiskDetector } from './detectors/IndexingCostRiskDetector';
import { PartitionMergeCandidateDetector } from './detectors/PartitionMergeCandidateDetector';
import { ShardKeyMisalignmentDetector } from './detectors/ShardKeyMisalignmentDetector';
import { SharedThroughputStarvationDetector } from './detectors/SharedThroughputStarvationDetector';
import { computeDerivedAdvisories } from './engine';

const base: DerivedAdvisoryInputs = {
    weeklyRuPercents: [],
    hasManualThroughput: false,
    partitions: [],
    storage: [],
    indexing: [],
};

describe('diagnostic result types', () => {
    it('constrains each detector to its own root causes and observations', () => {
        expectTypeOf(new IndexingCostRiskDetector().evaluateResult).returns.toEqualTypeOf<
            AdvisoryEvaluation<'IndexingCostRisk'>
        >();
        expectTypeOf<AdvisoryEvaluation<'IdleContainer'>['rootCause']>().toEqualTypeOf<
            'insufficient_data' | 'active' | 'idle'
        >();
        expectTypeOf<
            Extract<AdvisoryEvaluation<'IdleContainer'>, { rootCause: 'idle' }>['observations']
        >().toEqualTypeOf<{ recoverableRu: number }>();
        expectTypeOf<
            Extract<AdvisoryEvaluation<'IdleContainer'>, { rootCause: 'insufficient_data' | 'active' }>['observations']
        >().toEqualTypeOf<undefined>();
        expectTypeOf<
            Extract<
                AdvisoryEvaluation<'StorageGrowthRisk'>,
                { rootCause: 'rapid_growth' | 'at_or_over_limit' }
            >['observations']
        >().toEqualTypeOf<{ daysToLimit: number }>();
    });
});

function fanout(crossQueries: number, totalQueries: number, partitions: number, seconds = 3600): CrossPartitionInput {
    return {
        databaseId: 'db',
        containerId: 'items',
        evaluationWindowSeconds: seconds,
        shapes: [
            { text: 'SELECT * FROM c', executions: crossQueries, avgFanout: partitions, maxFanout: partitions },
            {
                text: 'SELECT * FROM c WHERE c.pk = @pk',
                executions: totalQueries - crossQueries,
                avgFanout: 1,
                maxFanout: 1,
            },
        ],
    };
}

describe('optional RU evidence is not detection policy or money', () => {
    it.each([undefined, 0, 0.01, 500, NaN, Infinity, -1])(
        'preserves fan-out and supersession decisions with average RU %s',
        (avgRu) => {
            const input = fanout(3600, 4000, 7);
            const enriched = {
                ...input,
                observationStart: '2026-11-11T08:00:00Z',
                observationEnd: '2026-11-11T09:00:00Z',
                shapes: input.shapes.map((shape) => ({ ...shape, avgRu })),
            };
            const before = computeDerivedAdvisories({ ...base, crossPartition: [input] }, DEFAULT_ADVISORY_THRESHOLDS);
            const after = computeDerivedAdvisories(
                { ...base, crossPartition: [enriched] },
                DEFAULT_ADVISORY_THRESHOLDS,
            );
            const decisions = (items: typeof before) =>
                items.map(({ id, severity, supersededBy }) => ({ id, severity, supersededBy }));
            expect(decisions(after)).toEqual(decisions(before));
            expect(after).toHaveLength(2);
            const valid = avgRu !== undefined && Number.isFinite(avgRu) && avgRu >= 0;
            for (const finding of after) {
                expect(finding.evidence?.queryRuStatus).toBe(valid ? 'observed' : 'unavailable');
                expect(finding.evidence?.worstShapeAvgRu).toBe(valid ? avgRu : undefined);
                expect(finding.evidence?.observationStart).toBe(valid ? enriched.observationStart : undefined);
                expect(finding.suggestedAction.includes('not estimated savings')).toBe(valid);
            }
        },
    );

    const readCharge: ConsistencyReadRuInput = {
        status: 'observed',
        readRequests: 10,
        readRu: 400,
        sourceTable: 'CDBDataPlaneRequests5M',
        sourceResolution: 'PT5M',
        observationStart: '2026-11-10T09:15:00Z',
        observationEnd: '2026-11-11T09:15:00Z',
    };

    it.each([
        undefined,
        readCharge,
        { ...readCharge, readRu: 0 },
        { ...readCharge, status: 'noObservations' as const, readRequests: 0, readRu: 0 },
        { ...readCharge, readRu: NaN },
        { ...readCharge, readRequests: 0.5 },
    ])('preserves the configuration verdict for read-charge evidence %j', (observed) => {
        const detector = new ExpensiveConsistencyDetector();
        const config = {
            accountName: 'prod',
            consistencyLevel: 'Strong',
            regionCount: 2,
            multiRegionWritesEnabled: false,
            writeRegionCount: 1,
            api: API.Core,
        };
        const finding = detector.evaluate(config, observed);
        expect(finding).toMatchObject({
            rule: 'ExpensiveConsistency',
            severity: 'Medium',
            actionEligibility: 'requiresValidation',
        });
        const valid =
            observed?.status === 'observed' && observed.readRequests === 10 && Number.isFinite(observed.readRu);
        expect(finding?.evidence?.observedReadRu).toBe(valid ? observed.readRu : undefined);
        expect(finding?.evidence?.upperBoundAvoidableReadRu).toBe(valid ? observed.readRu / 2 : undefined);
        expect(finding?.suggestedAction.includes('not measured or monetary savings')).toBe(valid);
        expect(finding?.evidence?.sourceTable).toBe(valid ? 'CDBDataPlaneRequests5M' : undefined);
        expect(detector.evaluate({ ...config, consistencyLevel: 'Session' }, observed)).toBeUndefined();
    });
});

describe('native autoscale model', () => {
    const detector = new AutoscaleMaxOverProvisionedDetector();
    it.each([
        [400, 10, 400, 0],
        [1000, 10, 1000, 0],
        [4000, 10, 1000, 300],
        [4000, 19.25, 1001, 299.9],
        [10000, 10, 1300, 870],
    ])('models maximum %s at peak %s without the manual floor clamp', (max, peak, target, recovery) => {
        const result = detector.evaluate(
            {
                databaseId: 'db',
                sampleCount: 24,
                configuredMaxRu: max,
                peakPercent: peak,
                avgPercent: peak,
            },
            30,
            30000,
        );
        expect(result?.scope).toBe('db');
        expect(result?.evidence?.recommendedMaxRu).toBe(target);
        expect(result?.evidence?.recoverableIdleFloorRu).toBeCloseTo(recovery);
        expect(result?.actionEligibility).toBe(recovery > 0 ? 'requiresValidation' : 'blocked');
        expect(result?.suggestedAction).toMatch(recovery === 0 ? /No maximum reduction/ : /Review lowering/);
    });

    it.each([NaN, Infinity, -1, 0])('rejects an invalid maximum %s', (max) => {
        expect(
            detector.evaluate(
                { databaseId: 'db', peakPercent: 10, avgPercent: 10, sampleCount: 24, configuredMaxRu: max },
                30,
            ),
        ).toBeUndefined();
    });

    it.each([29.99, 30, 30.01, 90])('uses the unrounded peak-band boundary %s', (peak) => {
        const result = detector.evaluate(
            { databaseId: 'db', peakPercent: peak, avgPercent: peak, sampleCount: 24, configuredMaxRu: 10000 },
            30,
        );
        expect(Boolean(result)).toBe(peak < 30);
    });

    it.each([
        [4000, 'High'],
        [30000, 'Medium'],
        [100000, 'Low'],
    ] as const)('uses the unchanged offer-capacity denominator %s', (scope, severity) => {
        expect(
            detector.evaluate(
                { databaseId: 'db', peakPercent: 10, avgPercent: 10, sampleCount: 24, configuredMaxRu: 4000 },
                30,
                scope,
            )?.severity,
        ).toBe(severity);
    });
});

describe('fan-out decisions at the observation interface', () => {
    it.each([59.95, 59.99, 60, 60.01])('does not round share %s before classification', (pct) => {
        const result = new ShardKeyMisalignmentDetector().evaluate(
            fanout(Math.round(pct * 100), 10000, 7),
            { structuralPct: 60, minPartitions: 2 },
            1.5,
        );
        const expectedShare = expect.closeTo(pct);
        expect(Boolean(result)).toBe(pct >= 60);
        expect(result?.evidence?.crossPartitionPct).toEqual(pct >= 60 ? expectedShare : undefined);
    });

    it.each([
        [359, undefined],
        [360, 'Medium'],
        [361, 'Medium'],
        [3599, 'Medium'],
        [3600, 'High'],
        [3601, 'High'],
    ] as const)('classifies %s fan-out queries per hour before rate rounding', (queries, severity) => {
        const result = new ShardKeyMisalignmentDetector().evaluate(
            fanout(queries, queries, 7),
            { structuralPct: 60, minPartitions: 2 },
            1.5,
        );
        expect(result?.severity).toBe(severity);
    });

    it.each([
        [2, 0.1, 'Low'],
        [3, 1, 'Low'],
        [4, 0.1, 'Low'],
        [6, 1, 'Medium'],
        [7, 0.1, 'Medium'],
        [7, 1, 'High'],
    ] as const)('grades %s partitions at %s queries/s as %s', (partitions, rate, severity) => {
        const result = new CrossPartitionQueryDetector().evaluate(fanout(rate * 3600, rate * 3600, partitions), {
            minQueries: 50,
            fanoutThreshold: 1.5,
            medPct: 10,
        });
        expect(result?.severity).toBe(severity);
    });

    it('uses the supplied duration rather than a fixed daily denominator', () => {
        const detector = new CrossPartitionQueryDetector();
        const thresholds = { minQueries: 50, fanoutThreshold: 1.5, medPct: 10 };
        expect(detector.evaluate(fanout(360, 360, 7, 3600), thresholds)?.severity).toBe('Medium');
        expect(detector.evaluate(fanout(360, 360, 7, 7200), thresholds)).toBeUndefined();
        expect(detector.evaluate(fanout(360, 360, 7, NaN), thresholds)).toBeUndefined();
    });
});

describe('merge structure versus action eligibility', () => {
    const detector = new PartitionMergeCandidateDetector();
    const input = {
        databaseId: 'db',
        containerId: 'items',
        actualPartitions: 4,
        provisionedRu: 10000,
        dataUsageBytes: 0,
    };

    it.each([undefined, NaN, Infinity, -1])('requires finite known throughput and storage (%s)', (value) => {
        expect(detector.evaluate({ ...input, provisionedRu: value })).toBeUndefined();
        expect(detector.evaluate({ ...input, dataUsageBytes: value })).toBeUndefined();
    });

    it('does not mistake 180 GiB for zero storage', () => {
        expect(detector.evaluate({ ...input, dataUsageBytes: 180 * 1024 ** 3 })).toBeUndefined();
        expect(detector.evaluate(input)?.severity).toBe('Medium');
    });

    it.each([
        [{ type: 'Continuous' }, 'blocked'],
        [{ type: 'Periodic' }, 'requiresValidation'],
        [{ type: 'Periodic', migrationState: { status: 'Completed', targetType: 'Periodic' } }, 'requiresValidation'],
        [undefined, 'unknown'],
        [{ type: 'Periodic', migrationState: { status: 'InProgress', targetType: 'Continuous' } }, 'unknown'],
        [{ type: 'Periodic', fullFidelityChangeFeedEnabled: true }, 'blocked'],
    ] as const)('retains the finding while gating backup state %j', (backupPolicy, eligibility) => {
        const result = detector.evaluate({ ...input, backupPolicy });
        expect(result?.severity).toBe('Medium');
        expect(result?.actionEligibility).toBe(eligibility);
        expect(result?.suggestedAction).not.toMatch(/Merge the physical partitions/);
    });
});

describe('configuration and indexing adoption', () => {
    it('suppresses explicitly disabled indexing and rejects non-finite storage sizes', () => {
        const detector = new IndexingCostRiskDetector();
        const input = {
            databaseId: 'db',
            containerId: 'items',
            indexUsageBytes: 200,
            dataUsageBytes: 100,
            userExcludedPathCount: 0,
        };
        expect(detector.evaluate({ ...input, indexingMode: 'none' }, 0.3)).toBeUndefined();
        expect(detector.evaluate({ ...input, dataUsageBytes: NaN }, 0.3)).toBeUndefined();
        expect(detector.evaluate({ ...input, indexUsageBytes: Infinity }, 0.3)).toBeUndefined();
    });

    it.each([
        ['Strong', 1, 'Medium'],
        ['Strong', 2, 'Medium'],
        ['BoundedStaleness', 1, undefined],
        ['BoundedStaleness', 2, 'Low'],
        ['Strong', 0, undefined],
        ['Strong', NaN, undefined],
        ['Session', 2, undefined],
    ] as const)(
        'evaluates %s in %s regions without conflating local and regional costs',
        (consistencyLevel, regionCount, severity) => {
            const result = new ExpensiveConsistencyDetector().evaluate({
                accountName: 'acct',
                regionCount,
                consistencyLevel,
                multiRegionWritesEnabled: false,
                writeRegionCount: 1,
                api: API.Core,
            });
            const tokenGuidance = expect.stringContaining('SessionToken');
            const correctnessGuidance = expect.stringContaining('not equivalent');
            expect(result?.severity).toBe(severity);
            expect(result?.suggestedAction).toEqual(severity ? tokenGuidance : undefined);
            expect(result?.suggestedAction).toEqual(severity ? correctnessGuidance : undefined);
        },
    );

    it.each([
        [0.3, undefined],
        [0.31, 'Low'],
        [1, 'Low'],
        [1.01, 'Medium'],
    ] as const)('uses ratio %s with user exclusions as evidence, not a veto', (ratio, severity) => {
        const result = new IndexingCostRiskDetector().evaluate(
            {
                databaseId: 'db',
                containerId: 'items',
                indexUsageBytes: ratio * 100,
                dataUsageBytes: 100,
                userExcludedPathCount: 2,
            },
            0.3,
        );
        expect(result?.severity).toBe(severity);
        expect(result?.evidence?.userExcludedPathCount).toBe(severity ? 2 : undefined);
    });
});

describe('shared offer ownership', () => {
    it('filters dedicated siblings before shared-pool totals and dominance decisions', () => {
        const detector = new SharedThroughputStarvationDetector();
        const thresholds = {
            minRequests: 100,
            poolThrottlePct: 5,
            dominancePct: 60,
            victimThrottlePct: 5,
            victimSharePct: 20,
        };
        const input = {
            databaseId: 'db',
            sharedRu: 4000,
            sharedContainerIds: ['a', 'b'],
            collections: [
                { containerId: 'a', requests: 1000, throttledRequests: 50, ruConsumed: 80 },
                { containerId: 'b', requests: 1000, throttledRequests: 50, ruConsumed: 20 },
                { containerId: 'dedicated', requests: 100000, throttledRequests: 0, ruConsumed: 10000 },
            ],
        };
        expect(detector.evaluate(input, thresholds)?.severity).toBe('High');
        expect(detector.evaluate({ ...input, sharedContainerIds: ['b'] }, thresholds)).toBeUndefined();
        expect(detector.evaluate({ ...input, sharedContainerIds: undefined }, thresholds)).toBeUndefined();
    });

    it('keeps database-scoped recovery and supersession separate from a dedicated sibling', () => {
        const results = computeDerivedAdvisories(
            {
                ...base,
                scopeProvisionedRuTotal: 5000,
                manualThroughput: [
                    { databaseId: 'db', provisionedRu: 4000, ruPercents: Array<number>(24).fill(10) },
                    {
                        databaseId: 'db',
                        containerId: 'dedicated',
                        provisionedRu: 1000,
                        ruPercents: Array<number>(24).fill(10),
                    },
                ],
                idleContainers: [
                    { databaseId: 'db', throughputMode: 'shared', provisionedRu: 4000, peakRuPerBucket: 0 },
                ],
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );
        expect(
            results.find((result) => result.rule === 'OverProvisioning' && result.scope === 'db')?.supersededBy,
        ).toBe('IdleContainer');
        expect(results.find((result) => result.scope === 'db/dedicated')?.supersededBy).toBeUndefined();
        expect(results.filter((result) => result.rule === 'IdleContainer')).toHaveLength(1);
    });
});
