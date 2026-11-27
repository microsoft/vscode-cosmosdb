/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext, type DetectorEvaluation } from '../core/Detector';
import { clampRationale, hasMinimumKnownResourceAge } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type AdvisoryEvaluation,
    type ContainerStorageInput,
    type DerivedAdvisory,
    type DerivedAdvisorySeverity,
} from '../core/types';
import {
    partitionCohorts,
    partitionCoverage,
    withPartitionWitness,
    type PartitionCoverageEvidence,
} from '../fetchers/partitionEvidence';
import {
    balanceRatio,
    GIB,
    PARTITION_STORAGE_LIMIT_BYTES,
    STORAGE_SKEW_HIGH_BYTES,
    STORAGE_SKEW_MEDIUM_BYTES,
    STORAGE_SKEW_MIN_BUSIEST_BYTES,
} from './storageMath';

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
function evaluateStorageSkewRisk(
    input: ContainerStorageInput,
    balanceThreshold: number,
): AdvisoryEvaluation<'StorageSkewRisk'> & { partitionEvidence?: PartitionCoverageEvidence } {
    if (
        balanceThreshold <= 0 ||
        !hasMinimumKnownResourceAge(input.resourceAgeDays, DIAGNOSTIC_POLICY.storageSkew.minResourceAgeDays)
    ) {
        return { rootCause: 'insufficient_data' };
    }
    const classify = (sizes: readonly number[]) => {
        const ratio = balanceRatio(sizes);
        const busiestBytes = Math.max(...sizes);
        const rootCause =
            sizes.length === 0
                ? 'insufficient_data'
                : sizes.length === 1
                  ? 'single_partition'
                  : busiestBytes < STORAGE_SKEW_MIN_BUSIEST_BYTES
                    ? 'too_small'
                    : ratio === undefined || ratio >= balanceThreshold
                      ? 'uniform_storage'
                      : 'storage_skew';
        const rank = busiestBytes >= STORAGE_SKEW_HIGH_BYTES ? 3 : busiestBytes >= STORAGE_SKEW_MEDIUM_BYTES ? 2 : 1;
        return { rootCause, busiestBytes, ratio, rank } as const;
    };
    const { regionalEvidence } = input;
    let partitionEvidence = regionalEvidence && partitionCoverage(regionalEvidence);
    let result: ReturnType<typeof classify>;
    if (regionalEvidence && partitionEvidence) {
        const classified = [...partitionCohorts(regionalEvidence)].map((cohort) => ({
            ...cohort,
            result: classify(cohort.histories.map((history) => Math.max(...history.values()))),
        }));
        const witness = classified
            .filter(({ result }) => result.rootCause === 'storage_skew')
            .sort((a, b) => b.result.rank - a.result.rank || b.buckets - a.buckets)[0];
        if (witness) {
            result = witness.result;
            partitionEvidence = withPartitionWitness(partitionEvidence, witness);
        } else {
            if (!partitionEvidence.coverageComplete || classified.length === 0) {
                return { rootCause: 'insufficient_data', partitionEvidence };
            }
            const causes = new Set(classified.map(({ result }) => result.rootCause));
            const rootCause = causes.size === 1 ? classified[0].result.rootCause : 'no_regional_skew';
            return { rootCause, partitionEvidence };
        }
    } else {
        const sizes = input.partitions
            .map((partition) => {
                const values = partition.samples
                    .map((sample) => sample.bytes)
                    .filter((bytes): bytes is number => Number.isFinite(bytes) && bytes >= 0);
                return values.length > 0 ? Math.max(...values) : undefined;
            })
            .filter((bytes): bytes is number => bytes !== undefined);
        result = classify(sizes);
        if (
            result.rootCause === 'single_partition' &&
            input.physicalPartitionCount !== undefined &&
            input.physicalPartitionCount !== 1
        ) {
            return { rootCause: 'insufficient_data' };
        }
    }
    const { rootCause, busiestBytes, ratio, rank } = result;
    if (rootCause !== 'storage_skew' || ratio === undefined) {
        return { rootCause, partitionEvidence };
    }
    const severity: DerivedAdvisorySeverity = rank === 3 ? 'High' : rank === 2 ? 'Medium' : 'Low';
    const scope = containerKey(input.databaseId, input.containerId);
    const busiestGiB = Math.round((busiestBytes / GIB) * 10) / 10;
    const balance = Math.round(ratio * 100) / 100;
    const threshold = Math.round(balanceThreshold * 100) / 100;
    const ceilingPercent = Math.round((busiestBytes / PARTITION_STORAGE_LIMIT_BYTES) * 100);
    const advisory: DerivedAdvisory = {
        id: `StorageSkewRisk:${scope}`,
        rule: 'StorageSkewRisk',
        severity,
        title: l10n.t('Uneven physical-partition storage in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t('Physical-partition storage in "{container}" is uneven.', {
                container: escapeAdvisoryText(input.containerId),
            }) +
                ' ' +
                l10n.t(
                    'The coolest partition holds only `{balance}×` the busiest (below the `{threshold}×` balance floor).',
                    { balance, threshold },
                ) +
                ' ' +
                l10n.t('The busiest is at `{busiest} GiB`, about `{ceiling}%` of the `50 GiB` split ceiling.', {
                    busiest: busiestGiB,
                    ceiling: ceilingPercent,
                }) +
                ' ' +
                l10n.t(
                    'A single oversized partition hits the split wall long before its balanced siblings, capping the container.',
                ),
        ),
        suggestedAction:
            (partitionEvidence?.witnessRegion
                ? l10n.t('Storage skew was observed in {region}.', { region: partitionEvidence.witnessRegion }) + ' '
                : '') +
            (partitionEvidence && !partitionEvidence.coverageComplete
                ? l10n.t('Coverage is partial; investigate the observed region first.') + ' '
                : '') +
            l10n.t('Review the partition key for a higher-cardinality choice so data spreads evenly.') +
            ' ' +
            l10n.t('Split or archive the oversized logical keys concentrating storage on one partition.'),
        thresholdReference: l10n.t('Threshold: min/max partition size < `{threshold}×` with busiest ≥ `1 GiB`', {
            threshold,
        }),
        scope,
        evidence: partitionEvidence && {
            partitionCoverageComplete: partitionEvidence.coverageComplete,
            witnessRegion: partitionEvidence.witnessRegion ?? null,
            comparableBuckets: partitionEvidence.comparableBuckets ?? null,
        },
    };
    return { rootCause: 'storage_skew', advisory, partitionEvidence };
}

export class StorageSkewRiskDetector extends Detector {
    readonly rule = 'StorageSkewRisk' as const;
    protected readonly notApplicableRootCauses = ['single_partition'];
    evaluateResult = evaluateStorageSkewRisk;
    evaluate = (...args: Parameters<typeof evaluateStorageSkewRisk>) => evaluateStorageSkewRisk(...args).advisory;
    protected evaluateInputs(ctx: DetectorContext): DetectorEvaluation[] {
        return (ctx.inputs.storageSkew ?? ctx.inputs.storage).map((storage) =>
            this.evaluateResult(storage, ctx.thresholds.storageSkewBalanceRatio),
        );
    }
}

export const storageSkewRiskDetector = new StorageSkewRiskDetector();
