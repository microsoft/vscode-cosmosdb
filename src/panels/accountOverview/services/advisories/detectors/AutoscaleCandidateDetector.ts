/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale, mean } from '../core/helpers';
import { type AutoscaleThresholds, type DerivedAdvisory } from '../core/types';

/**
 * AutoscaleCandidate (best-effort): a manual container whose 7-day RU profile is
 * a genuine burst — a real peak (`max ≥ maxPercent`) on a mostly-idle baseline
 * (`avg ≤ avgPercent`) with a large peak-to-average ratio (`≥ peakToAvgRatio`).
 * This is the duty cycle (average as a fraction of peak) that autoscale
 * economics turn on, not dispersion around the mean — a workload oscillating
 * 40↔60% has high variance yet a high duty cycle, so autoscale would cost more.
 * Pure.
 */
function evaluateAutoscaleCandidate(
    maxPercent: number | undefined,
    avgPercent: number | undefined,
    thresholds: AutoscaleThresholds,
    hasManualThroughput: boolean,
): DerivedAdvisory | undefined {
    if (!hasManualThroughput || maxPercent === undefined || avgPercent === undefined || avgPercent <= 0) {
        return undefined;
    }
    const peakToAvg = maxPercent / avgPercent;
    if (
        maxPercent < thresholds.maxPercent ||
        avgPercent > thresholds.avgPercent ||
        peakToAvg < thresholds.peakToAvgRatio
    ) {
        return undefined;
    }
    const max = Math.round(maxPercent);
    const avg = Math.round(avgPercent);
    const ratio = Math.round(peakToAvg * 10) / 10;
    return {
        id: 'AutoscaleCandidate',
        rule: 'AutoscaleCandidate',
        severity: 'Medium',
        title: l10n.t('Workload looks like an autoscale candidate'),
        rationale: clampRationale(
            l10n.t(
                'Over the last 7 days RU consumption peaked at {max}% but averaged just {avg}% — a {ratio}× peak-to-average burst on a mostly-idle baseline, while at least one container uses manual throughput. A tall peak over a low average is exactly the duty cycle where autoscale tracks demand more cheaply than fixed throughput sized for the peak.',
                { max, avg, ratio },
            ),
        ),
        suggestedAction: l10n.t(
            'Enable autoscale on the bursty containers so provisioned RU/s follows demand between the configured floor and ceiling.',
        ),
        thresholdReference: l10n.t('Threshold: peak ≥ {max}%, average ≤ {avg}%, and peak/average ≥ {ratio}×', {
            max: thresholds.maxPercent,
            avg: thresholds.avgPercent,
            ratio: thresholds.peakToAvgRatio,
        }),
    };
}

export class AutoscaleCandidateDetector extends Detector {
    readonly rule = 'AutoscaleCandidate' as const;
    evaluate = evaluateAutoscaleCandidate;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const { inputs, thresholds } = ctx;
        const advisory = this.evaluate(
            inputs.weeklyPeakPercent ??
                (inputs.weeklyRuPercents.length > 0 ? Math.max(...inputs.weeklyRuPercents) : undefined),
            inputs.weeklyRuPercents.length > 0 ? mean(inputs.weeklyRuPercents) : undefined,
            {
                maxPercent: thresholds.autoscaleMaxPercent,
                avgPercent: thresholds.autoscaleAvgPercent,
                peakToAvgRatio: thresholds.autoscalePeakToAvgRatio,
            },
            inputs.hasManualThroughput,
        );
        return advisory ? [advisory] : [];
    }
}

export const autoscaleCandidateDetector = new AutoscaleCandidateDetector();
