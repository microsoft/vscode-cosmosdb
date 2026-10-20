/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale, hasMinimumKnownResourceAge } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type DerivedAdvisory, type DerivedAdvisorySeverity, type PartitionSaturationInput } from '../core/types';

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
): DerivedAdvisory | undefined {
    if (
        !hasMinimumKnownResourceAge(input.resourceAgeDays, DIAGNOSTIC_POLICY.partitionSaturation.minResourceAgeDays) ||
        input.partitionCount < DIAGNOSTIC_POLICY.partitionSaturation.minHotPartitions ||
        input.maxP99 < saturationPercent ||
        input.minP99 >= headroomPercent
    ) {
        return undefined;
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const busiest = Math.round(input.maxP99);
    const coolest = Math.round(input.minP99);
    const saturation = Math.round(saturationPercent);
    const headroom = Math.round(headroomPercent);
    const throttling = input.throttleRatePercent >= throttleThresholdPercent;
    const severity: DerivedAdvisorySeverity = throttling ? 'High' : 'Medium';

    const impact = throttling
        ? l10n.t('The container is already throttling (HTTP 429), so the hot partition is capping real traffic.')
        : l10n.t(
              'It is not throttling yet, but the pinned partition cannot borrow spare capacity from the other partitions as load grows.',
          );

    return {
        id: `HotPartitionRisk:${scope}`,
        rule: 'HotPartitionRisk',
        severity,
        title: l10n.t('Hot physical partition in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'In "{container}", the busiest of `{count} physical partitions` ran at `{busiest}%` p99 utilization.',
                {
                    container: escapeAdvisoryText(input.containerId),
                    count: input.partitionCount,
                    busiest,
                },
            ) +
                ' ' +
                l10n.t(
                    'This is at or above the `{saturation}%` saturation mark. The coolest sat at `{coolest}%`, below the `{headroom}%` headroom mark.',
                    { saturation, coolest, headroom },
                ) +
                ' ' +
                l10n.t('Load is concentrated by the partition key, not a global shortfall.') +
                ' ' +
                impact,
        ),
        suggestedAction:
            l10n.t(
                'Redesign the partition key for higher cardinality so traffic spreads across partitions. Re-keying an existing container is migration-class.',
            ) +
            ' ' +
            l10n.t(
                'Per-partition or per-region autoscale can soften the cost of feeding the hot partition while you redesign.',
            ) +
            ' ' +
            l10n.t('It does not remove the throttling on a single hot key.'),
        thresholdReference: l10n.t('Threshold: busiest partition p99 ≥ `{saturation}%` while another < `{headroom}%`', {
            saturation,
            headroom,
        }),
        scope,
    };
}

export class HotPartitionRiskDetector extends Detector {
    readonly rule = 'HotPartitionRisk' as const;
    evaluate = evaluateHotPartitionRisk;
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

export const hotPartitionRiskDetector = new HotPartitionRiskDetector();
