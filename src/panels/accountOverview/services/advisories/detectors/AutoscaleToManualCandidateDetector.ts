/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type AutoscaleUtilizationInput, type DerivedAdvisory } from '../core/types';

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
): DerivedAdvisory | undefined {
    if (input.sampleCount === 0 || input.avgPercent <= 0) {
        return undefined;
    }
    const peakToAvg = input.peakPercent / input.avgPercent;
    if (input.avgPercent < avgFloorPercent || peakToAvg > peakToAvgCeiling) {
        return undefined;
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const avg = Math.round(input.avgPercent);
    const peak = Math.round(input.peakPercent);
    const ratio = Math.round(peakToAvg * 10) / 10;
    return {
        id: `AutoscaleToManualCandidate:${scope}`,
        rule: 'AutoscaleToManualCandidate',
        severity: 'Medium',
        title: l10n.t('Autoscale container looks steady — manual may be cheaper'),
        rationale: clampRationale(
            l10n.t(
                'Autoscale on "{container}" averaged {avg}% of its max with a peak of {peak}% — a {ratio}× peak-to-average, so the load is steady and high with little spikiness. Autoscale carries a per-RU premium over manual, and a workload that stays high does not benefit from scaling.',
                { container: input.containerId, avg, peak, ratio },
            ),
        ),
        suggestedAction: l10n.t(
            'Consider converting "{container}" to manual throughput at a fixed RU/s near the sustained level to drop the autoscale premium.',
            { container: input.containerId },
        ),
        thresholdReference: l10n.t('Threshold: average ≥ {avg}% of max and peak/average ≤ {ratio}×', {
            avg: Math.round(avgFloorPercent),
            ratio: Math.round(peakToAvgCeiling * 10) / 10,
        }),
        scope,
    };
}

export class AutoscaleToManualCandidateDetector extends Detector {
    readonly rule = 'AutoscaleToManualCandidate' as const;
    evaluate = evaluateAutoscaleToManualCandidate;
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
