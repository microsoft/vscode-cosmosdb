/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale, hasMinimumKnownResourceAge, offerScope } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type AdvisoryEvaluation, type AutoscaleUtilizationInput, type DerivedAdvisory } from '../core/types';

/**
 * AutoscaleToManualCandidate (CODA DX-013): an *autoscale* container whose load is **steady-high** — average
 * sustained near the max with little spikiness. Autoscale carries a per-RU premium over manual, so a workload
 * that stays high does not benefit from scaling and would be cheaper on manual at a fixed RU/s. Steady ⇔ average
 * ≥ `avgFloorPercent` of the max AND peak-to-average ≤ `peakToAvgCeiling` (flat, not bursty). Qualitative (a
 * pricing-mode change, not a capacity recovery), so severity is Medium. Pure.
 */
function evaluateAutoscaleToManualCandidate(
    input: AutoscaleUtilizationInput,
    avgFloorPercent: number,
    peakToAvgCeiling: number,
): AdvisoryEvaluation<'AutoscaleToManualCandidate'> {
    if (
        input.sampleCount < DIAGNOSTIC_POLICY.autoscaleUtilization.minSamples ||
        input.avgPercent <= 0 ||
        !hasMinimumKnownResourceAge(input.resourceAgeDays, DIAGNOSTIC_POLICY.autoscaleUtilization.minResourceAgeDays)
    ) {
        return { rootCause: 'insufficient_data' };
    }
    const peakToAvg = input.peakPercent / input.avgPercent;
    if (input.avgPercent < avgFloorPercent || peakToAvg > peakToAvgCeiling) {
        return { rootCause: 'well_matched' };
    }
    const scope = offerScope(input);
    const avg = Math.round(input.avgPercent);
    const peak = Math.round(input.peakPercent);
    const ratio = Math.round(peakToAvg * 10) / 10;
    const advisory: DerivedAdvisory = {
        id: `AutoscaleToManualCandidate:${scope}`,
        rule: 'AutoscaleToManualCandidate',
        severity: 'Medium',
        title: l10n.t('Autoscale offer looks steady: manual may be cheaper'),
        rationale: clampRationale(
            l10n.t(
                'Autoscale on "{container}" averaged `{avg}%` of its max with a peak of `{peak}%`, a `{ratio}×` peak-to-average.',
                { container: escapeAdvisoryText(input.containerId ?? input.databaseId), avg, peak, ratio },
            ) +
                ' ' +
                l10n.t('The load is steady and high with little spikiness.') +
                ' ' +
                l10n.t(
                    'Autoscale carries a per-RU premium over manual, and a workload that stays high does not benefit from scaling.',
                ),
        ),
        suggestedAction: l10n.t(
            'Consider converting "{container}" to manual throughput at a fixed RU/s near the sustained level to drop the autoscale premium.',
            { container: escapeAdvisoryText(input.containerId ?? input.databaseId) },
        ),
        thresholdReference: l10n.t('Threshold: average ≥ `{avg}%` of max and peak/average ≤ `{ratio}×`', {
            avg: Math.round(avgFloorPercent),
            ratio: Math.round(peakToAvgCeiling * 10) / 10,
        }),
        scope,
    };
    return { rootCause: 'steady_autoscale', advisory };
}

export class AutoscaleToManualCandidateDetector extends Detector {
    readonly rule = 'AutoscaleToManualCandidate' as const;
    evaluateResult = evaluateAutoscaleToManualCandidate;
    evaluate = (...args: Parameters<typeof evaluateAutoscaleToManualCandidate>) =>
        evaluateAutoscaleToManualCandidate(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const out: DerivedAdvisory[] = [];
        for (const util of ctx.inputs.autoscaleUtilizations ?? []) {
            const a = this.evaluate(
                util,
                ctx.thresholds.autoscaleToManualAvgPercent,
                ctx.thresholds.autoscaleToManualPeakToAvgRatio,
            );
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const autoscaleToManualCandidateDetector = new AutoscaleToManualCandidateDetector();
