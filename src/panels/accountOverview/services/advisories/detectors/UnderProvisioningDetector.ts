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

type CapacityResult = AdvisoryEvaluation<'SustainedThrottlingInRegion'> & {
    partitionEvidence?: PartitionCoverageEvidence;
};

/**
 * SustainedThrottlingInRegion / genuine under-provisioning (DX-005): a container is sustaining 429 throttling
 * (rate at or above the threshold) **and** at least one partition is saturated, **and** the saturation is
 * *uniform* — every partition is busy (coolest p99 at or above the headroom mark). Uniform saturation means the
 * workload simply needs more capacity; the non-uniform (skew) case is left to HotPartitionRisk (DX-006) so the two
 * never double-report the same throttling. A `min-requests` gate abstains on traffic too low to judge. Severity
 * grades by the 429 rate. Pure.
 */
function evaluateUnderProvisioning(
    input: PartitionSaturationInput,
    saturationPercent: number,
    headroomPercent: number,
    throttleThresholdPercent: number,
): CapacityResult {
    const { totalRequests, throttleRatePercent, regionalEvidence } = input;
    if (
        totalRequests === undefined ||
        !Number.isFinite(totalRequests) ||
        throttleRatePercent === undefined ||
        !Number.isFinite(throttleRatePercent) ||
        !hasMinimumKnownResourceAge(input.resourceAgeDays, DIAGNOSTIC_POLICY.partitionSaturation.minResourceAgeDays)
    ) {
        return { rootCause: 'insufficient_data' };
    }
    const throttledRequests = input.throttledRequests;
    const observations =
        throttledRequests !== undefined &&
        Number.isFinite(throttledRequests) &&
        throttledRequests >= 0 &&
        throttledRequests <= totalRequests
            ? { throttledRequests, totalRequests, throttleRatePercent }
            : undefined;
    const evidence = regionalEvidence && partitionCoverage(regionalEvidence);
    const retained = { observations, partitionEvidence: evidence };
    if (totalRequests < DIAGNOSTIC_POLICY.underProvisioning.minRequests || (regionalEvidence && !observations)) {
        return { rootCause: 'insufficient_data', ...retained };
    }
    if (!regionalEvidence && throttleRatePercent < throttleThresholdPercent) {
        return { rootCause: 'not_throttling' };
    }
    if (throttleRatePercent < throttleThresholdPercent) {
        if (!observations?.throttledRequests) {
            return { rootCause: 'not_throttling', ...retained };
        }
        return {
            ...retained,
            rootCause: 'below_throttle_threshold',
            observations: {
                ...observations,
                explanation: l10n.t('The observed 429 rate is below the {threshold}% throttling threshold.', {
                    threshold: throttleThresholdPercent,
                }),
            },
        };
    }
    const severity: DerivedAdvisorySeverity =
        throttleRatePercent >= DIAGNOSTIC_POLICY.underProvisioning.highThrottleRatePercent
            ? 'High'
            : throttleRatePercent >= DIAGNOSTIC_POLICY.underProvisioning.mediumThrottleRatePercent
              ? 'Medium'
              : 'Low';
    const hasCapacityPressure = ({ maxP99 }: Pick<PartitionSaturationInput, 'maxP99'>): boolean =>
        maxP99 >= saturationPercent;
    const hasHeadroom = ({ minP99 }: Pick<PartitionSaturationInput, 'minP99'>): boolean => minP99 < headroomPercent;
    let representative = { maxP99: input.maxP99, minP99: input.minP99 };

    if (regionalEvidence && evidence) {
        const cohorts = regionalSaturation(regionalEvidence, DIAGNOSTIC_POLICY.partitionSaturation.percentile);
        const skew = cohorts.find(
            (cohort) => cohort.partitionCount > 1 && hasCapacityPressure(cohort) && hasHeadroom(cohort),
        );
        if (skew) {
            return {
                ...retained,
                rootCause: 'skew_suspected',
                severity,
                partitionEvidence: withPartitionWitness(evidence, skew),
                observations: observations && {
                    ...observations,
                    explanation: l10n.t(
                        'Regional partition skew was observed; investigate its cause before adding throughput.',
                    ),
                },
            };
        }
        if (!evidence.coverageComplete || cohorts.length === 0) {
            return {
                ...retained,
                rootCause: 'insufficient_data',
                observations: observations && {
                    ...observations,
                    explanation: l10n.t(
                        'Incomplete physical partition coverage prevents a whole-offer capacity diagnosis.',
                    ),
                },
            };
        }
        const saturated = cohorts.filter((cohort) => hasCapacityPressure(cohort) && !hasHeadroom(cohort));
        if (saturated.length < cohorts.length) {
            return {
                ...retained,
                rootCause: saturated.length ? 'regional_saturation' : 'throttling_without_saturation',
                observations: observations && {
                    ...observations,
                    explanation: saturated.length
                        ? l10n.t(
                              'Only some configured regions are saturated; this does not establish a whole-offer capacity shortfall.',
                          )
                        : l10n.t('The measured partition utilization levels do not explain the throttling.'),
                },
            };
        }
        representative = saturated[0];
    } else {
        // A legacy summary does not identify a region or prove that every partition was observed.
        if (!Number.isFinite(input.maxP99) || !Number.isFinite(input.minP99) || input.partitionCount < 1) {
            return { rootCause: 'insufficient_data' };
        }
        if (!hasCapacityPressure(input)) {
            return { rootCause: 'not_throttling' };
        }
        if (hasHeadroom(input)) {
            return { rootCause: 'skew_suspected', severity };
        }
        if (input.physicalPartitionCount !== undefined && input.physicalPartitionCount !== input.partitionCount) {
            return { rootCause: 'insufficient_data' };
        }
    }
    const scope = offerScope(input);
    const name = input.containerId ?? input.databaseId;
    const rate = Math.round(throttleRatePercent * 10) / 10;
    const busiest = Math.round(representative.maxP99);
    const coolest = Math.round(representative.minP99);

    const action =
        input.throughputMode === 'autoscale'
            ? input.provisionedRu !== undefined
                ? l10n.t(
                      'Raise the autoscale maximum above `{ru} RU/s`. The workload is pinned at the current ceiling.',
                      {
                          ru: Math.round(input.provisionedRu).toLocaleString(),
                      },
                  )
                : l10n.t('Raise the autoscale maximum. The workload is pinned at the current ceiling.')
            : input.provisionedRu !== undefined
              ? l10n.t(
                    'Raise provisioned throughput above `{ru} RU/s`, or convert to autoscale if the demand is bursty.',
                    {
                        ru: Math.round(input.provisionedRu).toLocaleString(),
                    },
                )
              : l10n.t('Raise provisioned throughput, or convert to autoscale if the demand is bursty.');

    const advisory: DerivedAdvisory = {
        id: `SustainedThrottlingInRegion:${scope}`,
        rule: 'SustainedThrottlingInRegion',
        severity,
        title: l10n.t('Sustained throttling in {container}', { container: name }),
        rationale: clampRationale(
            l10n.t('In "{container}", `{rate}%` of requests were throttled (HTTP 429).', {
                container: escapeAdvisoryText(name),
                rate,
            }) +
                ' ' +
                l10n.t(
                    'The busiest partition reached `{busiest}%` p99 and even the coolest stayed at `{coolest}%` p99.',
                    {
                        busiest,
                        coolest,
                    },
                ) +
                ' ' +
                l10n.t('The coolest partition still cleared the `{headroom}%` broad-saturation floor.', {
                    headroom: Math.round(headroomPercent),
                }) +
                ' ' +
                l10n.t('This indicates a genuine capacity shortfall rather than a single hot partition.'),
        ),
        suggestedAction: action,
        thresholdReference: l10n.t(
            'Threshold: 429 rate ≥ `{rate}%`, busiest partition p99 ≥ `{saturation}%`, coolest partition p99 ≥ `{headroom}%`',
            {
                rate: Math.round(throttleThresholdPercent),
                saturation: Math.round(saturationPercent),
                headroom: Math.round(headroomPercent),
            },
        ),
        scope,
    };
    return { rootCause: 'global_under_provisioning', advisory, ...retained };
}

export class UnderProvisioningDetector extends Detector {
    readonly rule = 'SustainedThrottlingInRegion' as const;
    evaluateResult = evaluateUnderProvisioning;
    evaluate = (...args: Parameters<typeof evaluateUnderProvisioning>) => evaluateUnderProvisioning(...args).advisory;
    protected evaluateInputs(ctx: DetectorContext): DetectorEvaluation[] {
        const t = ctx.thresholds;

        return ctx.inputs.partitions.map((partition) => {
            const result = this.evaluateResult(
                partition,
                t.partitionSaturationPercent,
                t.partitionHeadroomPercent,
                t.throttleRatePercent,
            );
            if (!result.advisory && result.observations && result.observations.throttledRequests > 0) {
                return { ...result, capacityThrottling: { scope: offerScope(partition), ...result.observations } };
            }
            return result;
        });
    }
}

export const underProvisioningDetector = new UnderProvisioningDetector();
