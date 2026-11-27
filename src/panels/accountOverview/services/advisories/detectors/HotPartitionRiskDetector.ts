/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { Detector, type DetectorContext, type DetectorEvaluation } from '../core/Detector';
import { clampRationale, hasMinimumKnownResourceAge, offerScope } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type AdvisoryEvaluation,
    type DerivedAdvisory,
    type DerivedAdvisorySeverity,
    type PartitionSaturationInput,
} from '../core/types';
import {
    partitionCoverage,
    regionalSaturation,
    withPartitionWitness,
    type PartitionCoverageEvidence,
} from '../fetchers/partitionEvidence';

/**
 * HotPartitionRisk (DX-006): the busiest physical partition is **saturated** (p99 at or above the saturation
 * threshold) while at least one other partition still has **headroom** (p99 below the headroom threshold). Unlike a
 * raw share or fair-share cutoff, this keys off "is some partition pinned at capacity while another is cool" — the
 * signal that the partition key, not more RU/s, is the fix. A single partition, or uniform saturation (every
 * partition busy → global under-provisioning, DX-005), never fires here. Severity scales with actual impact: active
 * throttling (429 rate at or above the threshold) → High, saturated-but-not-throttling → Medium. Pure.
 */
function evaluateHotPartitionRisk(
    input: PartitionSaturationInput,
    saturationPercent: number,
    headroomPercent: number,
    throttleThresholdPercent: number,
): AdvisoryEvaluation<'HotPartitionRisk'> & { partitionEvidence?: PartitionCoverageEvidence } {
    if (!hasMinimumKnownResourceAge(input.resourceAgeDays, DIAGNOSTIC_POLICY.partitionSaturation.minResourceAgeDays)) {
        return { rootCause: 'insufficient_data' };
    }
    const classify = ({
        maxP99,
        minP99,
        partitionCount,
    }: Pick<PartitionSaturationInput, 'maxP99' | 'minP99' | 'partitionCount'>) =>
        partitionCount < DIAGNOSTIC_POLICY.partitionSaturation.minHotPartitions
            ? 'single_partition'
            : maxP99 < saturationPercent
              ? 'not_saturated'
              : minP99 >= headroomPercent
                ? 'uniform_saturation'
                : 'hot_partition';
    const { regionalEvidence } = input;
    let partitionEvidence = regionalEvidence && partitionCoverage(regionalEvidence);
    let representative = { maxP99: input.maxP99, minP99: input.minP99, partitionCount: input.partitionCount };
    if (regionalEvidence && partitionEvidence) {
        const cohorts = regionalSaturation(regionalEvidence, DIAGNOSTIC_POLICY.partitionSaturation.percentile);
        const witness = cohorts
            .filter((cohort) => classify(cohort) === 'hot_partition')
            .sort((a, b) => b.buckets - a.buckets)[0];
        if (witness) {
            representative = witness;
            partitionEvidence = withPartitionWitness(partitionEvidence, witness);
        } else {
            if (!partitionEvidence.coverageComplete || cohorts.length === 0) {
                return { rootCause: 'insufficient_data', partitionEvidence };
            }
            const causes = new Set(cohorts.map(classify));
            const rootCause = causes.size === 1 ? classify(cohorts[0]) : 'no_regional_skew';
            return { rootCause, partitionEvidence };
        }
    } else {
        if (input.partitionCount === 0 || !Number.isFinite(input.maxP99) || !Number.isFinite(input.minP99)) {
            return { rootCause: 'insufficient_data' };
        }
        const rootCause = classify(input);
        if (
            rootCause === 'single_partition' &&
            input.physicalPartitionCount !== undefined &&
            input.physicalPartitionCount !== 1
        ) {
            return { rootCause: 'insufficient_data' };
        }
        if (rootCause !== 'hot_partition') {
            return { rootCause };
        }
        if (input.throttleRatePercent === undefined) {
            return { rootCause: 'insufficient_data' };
        }
    }
    const scope = offerScope(input);
    const name = input.containerId ?? input.databaseId;
    const busiest = Math.round(representative.maxP99);
    const coolest = Math.round(representative.minP99);
    const saturation = Math.round(saturationPercent);
    const headroom = Math.round(headroomPercent);
    const throttling = (input.throttleRatePercent ?? 0) >= throttleThresholdPercent;
    const severity: DerivedAdvisorySeverity = throttling ? 'High' : 'Medium';

    const impact = throttling
        ? l10n.t('The offer is also recording HTTP 429 responses.')
        : input.throttleRatePercent === undefined
          ? l10n.t('The offer-level throttling rate was unavailable.')
          : l10n.t('The offer-level 429 rate is below the throttling threshold.');

    const advisory: DerivedAdvisory = {
        id: `HotPartitionRisk:${scope}`,
        rule: 'HotPartitionRisk',
        severity,
        title: l10n.t('Hot physical partition in {container}', { container: name }),
        rationale: clampRationale(
            l10n.t(
                'In "{container}", the busiest of `{count} physical partitions` ran at `{busiest}%` p99 utilization.',
                {
                    container: escapeAdvisoryText(name),
                    count: representative.partitionCount,
                    busiest,
                },
            ) +
                ' ' +
                l10n.t(
                    'This is at or above the `{saturation}%` saturation mark. The coolest sat at `{coolest}%`, below the `{headroom}%` headroom mark.',
                    { saturation, coolest, headroom },
                ) +
                ' ' +
                l10n.t('This is evidence of uneven physical-partition load.') +
                ' ' +
                impact,
        ),
        suggestedAction:
            (partitionEvidence?.witnessRegion
                ? l10n.t('Skew was observed in {region}.', { region: partitionEvidence.witnessRegion }) + ' '
                : '') +
            (partitionEvidence && !partitionEvidence.coverageComplete
                ? l10n.t('Coverage is partial; investigate the observed region first.') + ' '
                : '') +
            l10n.t(
                'Investigate which keys consume the most RU before changing throughput or redesigning the partition key.',
            ) +
            ' ' +
            l10n.t('These metrics cannot identify a logical partition key or tell which partition returned a 429.'),
        thresholdReference: l10n.t('Threshold: busiest partition p99 ≥ `{saturation}%` while another < `{headroom}%`', {
            saturation,
            headroom,
        }),
        scope,
        evidence: partitionEvidence && {
            partitionCoverageComplete: partitionEvidence.coverageComplete,
            witnessRegion: partitionEvidence.witnessRegion ?? null,
            comparableBuckets: partitionEvidence.comparableBuckets ?? null,
        },
    };
    return { rootCause: 'hot_partition', advisory, partitionEvidence };
}

export class HotPartitionRiskDetector extends Detector {
    readonly rule = 'HotPartitionRisk' as const;
    protected readonly notApplicableRootCauses = ['single_partition'];
    evaluateResult = evaluateHotPartitionRisk;
    evaluate = (...args: Parameters<typeof evaluateHotPartitionRisk>) => evaluateHotPartitionRisk(...args).advisory;
    protected evaluateInputs(ctx: DetectorContext): DetectorEvaluation[] {
        const t = ctx.thresholds;

        return ctx.inputs.partitions.map((p) =>
            this.evaluateResult(p, t.partitionSaturationPercent, t.partitionHeadroomPercent, t.throttleRatePercent),
        );
    }
}

export const hotPartitionRiskDetector = new HotPartitionRiskDetector();
