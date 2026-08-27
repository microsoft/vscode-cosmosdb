/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type DerivedAdvisory, type DerivedAdvisorySeverity, type PartitionSaturationInput } from '../core/types';

/** Container 429 rate (%) at or above which under-provisioning severity is High. */
const UNDER_PROVISIONING_HIGH_RATE_PCT = 20;
/** Container 429 rate (%) at or above which under-provisioning severity is Medium (below this, Low). */
const UNDER_PROVISIONING_MEDIUM_RATE_PCT = 5;
/** Below this request count the 429 rate is too noisy to judge, so the rule abstains. */
const UNDER_PROVISIONING_MIN_REQUESTS = 1_000;

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
    if (input.totalRequests < UNDER_PROVISIONING_MIN_REQUESTS) {
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
        input.throttleRatePercent >= UNDER_PROVISIONING_HIGH_RATE_PCT
            ? 'High'
            : input.throttleRatePercent >= UNDER_PROVISIONING_MEDIUM_RATE_PCT
              ? 'Medium'
              : 'Low';

    const action =
        input.throughputMode === 'autoscale'
            ? input.provisionedRu !== undefined
                ? l10n.t('Raise the autoscale maximum above {ru} RU/s. It is pinned at the ceiling.', {
                      ru: Math.round(input.provisionedRu).toLocaleString(),
                  })
                : l10n.t('Raise the autoscale maximum. It is pinned at the ceiling.')
            : input.provisionedRu !== undefined
              ? l10n.t('Raise provisioned throughput above {ru} RU/s, or convert to autoscale.', {
                    ru: Math.round(input.provisionedRu).toLocaleString(),
                })
              : l10n.t('Raise provisioned throughput, or convert to autoscale.');

    return {
        id: `SustainedThrottlingInRegion:${scope}`,
        rule: 'SustainedThrottlingInRegion',
        severity,
        title: l10n.t('Sustained throttling in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'In "{container}", {rate}% of requests were throttled (HTTP 429) while every physical partition was saturated (busiest p99 {busiest}%, coolest {coolest}%). Because all partitions are at capacity, not just one, this is a genuine capacity shortfall rather than a hot partition.',
                { container: input.containerId, rate, busiest, coolest },
            ),
        ),
        suggestedAction: action,
        thresholdReference: l10n.t('Threshold: 429 rate ≥ {rate}% with every partition p99 ≥ {saturation}%', {
            rate: Math.round(throttleThresholdPercent),
            saturation: Math.round(saturationPercent),
        }),
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
