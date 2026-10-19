/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale, hasMinimumKnownResourceAge } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type DerivedAdvisory, type DerivedAdvisorySeverity, type PartitionSaturationInput } from '../core/types';

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
): DerivedAdvisory | undefined {
    if (
        input.totalRequests < DIAGNOSTIC_POLICY.underProvisioning.minRequests ||
        !hasMinimumKnownResourceAge(input.resourceAgeDays, DIAGNOSTIC_POLICY.partitionSaturation.minResourceAgeDays)
    ) {
        return undefined;
    }
    const throttling = input.throttleRatePercent >= throttleThresholdPercent;
    const atCapacity = input.maxP99 >= saturationPercent;
    const uniform = input.minP99 >= headroomPercent;
    if (!throttling || !atCapacity || !uniform) {
        return undefined;
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const rate = Math.round(input.throttleRatePercent * 10) / 10;
    const busiest = Math.round(input.maxP99);
    const coolest = Math.round(input.minP99);
    const severity: DerivedAdvisorySeverity =
        input.throttleRatePercent >= DIAGNOSTIC_POLICY.underProvisioning.highThrottleRatePercent
            ? 'High'
            : input.throttleRatePercent >= DIAGNOSTIC_POLICY.underProvisioning.mediumThrottleRatePercent
              ? 'Medium'
              : 'Low';

    const action =
        input.throughputMode === 'autoscale'
            ? input.provisionedRu !== undefined
                ? l10n.t(
                      'Raise the autoscale maximum above {ru} RU/s. The workload is pinned at the current ceiling.',
                      {
                          ru: Math.round(input.provisionedRu).toLocaleString(),
                      },
                  )
                : l10n.t('Raise the autoscale maximum. The workload is pinned at the current ceiling.')
            : input.provisionedRu !== undefined
              ? l10n.t(
                    'Raise provisioned throughput above {ru} RU/s, or convert to autoscale if the demand is bursty.',
                    {
                        ru: Math.round(input.provisionedRu).toLocaleString(),
                    },
                )
              : l10n.t('Raise provisioned throughput, or convert to autoscale if the demand is bursty.');

    return {
        id: `SustainedThrottlingInRegion:${scope}`,
        rule: 'SustainedThrottlingInRegion',
        severity,
        title: l10n.t('Sustained throttling in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t('In "{container}", {rate}% of requests were throttled (HTTP 429).', {
                container: input.containerId,
                rate,
            }) +
                ' ' +
                l10n.t('The busiest partition reached {busiest}% p99 and even the coolest stayed at {coolest}% p99.', {
                    busiest,
                    coolest,
                }) +
                ' ' +
                l10n.t('The coolest partition still cleared the {headroom}% broad-saturation floor.', {
                    headroom: Math.round(headroomPercent),
                }) +
                ' ' +
                l10n.t('This indicates a genuine capacity shortfall rather than a single hot partition.'),
        ),
        suggestedAction: action,
        thresholdReference: l10n.t(
            'Threshold: 429 rate ≥ {rate}%, busiest partition p99 ≥ {saturation}%, coolest partition p99 ≥ {headroom}%',
            {
                rate: Math.round(throttleThresholdPercent),
                saturation: Math.round(saturationPercent),
                headroom: Math.round(headroomPercent),
            },
        ),
        scope,
    };
}

export class UnderProvisioningDetector extends Detector {
    readonly rule = 'SustainedThrottlingInRegion' as const;
    evaluate = evaluateUnderProvisioning;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const t = ctx.thresholds;
        const out: DerivedAdvisory[] = [];
        for (const p of ctx.inputs.partitions) {
            const a = this.evaluate(p, t.partitionSaturationPercent, t.partitionHeadroomPercent, t.throttleRatePercent);
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const underProvisioningDetector = new UnderProvisioningDetector();
