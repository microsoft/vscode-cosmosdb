/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale, finiteNumbers, hasMinimumKnownResourceAge, mean } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type AutoscaleThresholds, type DerivedAdvisory, type ManualThroughputInput } from '../core/types';

const AUTOSCALE_MIN_MAX_RU = 1_000;
const AUTOSCALE_STEP_RU = 1_000;

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
    provisionedRu?: number,
    scope?: string,
    containerId?: string,
    observationLabel: string = '7 days',
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
    const recommendedMax =
        provisionedRu !== undefined && provisionedRu > 0
            ? Math.max(
                  AUTOSCALE_MIN_MAX_RU,
                  Math.ceil(
                      ((maxPercent / 100) * provisionedRu * DIAGNOSTIC_POLICY.overProvisioning.headroomMultiplier) /
                          AUTOSCALE_STEP_RU,
                  ) * AUTOSCALE_STEP_RU,
              )
            : undefined;
    return {
        id: scope ? `AutoscaleCandidate:${scope}` : 'AutoscaleCandidate',
        rule: 'AutoscaleCandidate',
        severity: 'Medium',
        title: containerId
            ? l10n.t('Workload in {container} looks like an autoscale candidate', { container: containerId })
            : l10n.t('Workload looks like an autoscale candidate'),
        rationale: clampRationale(
            l10n.t('Over the last {window} RU consumption peaked at {max}% but averaged just {avg}%.', {
                window: observationLabel,
                max,
                avg,
            }) +
                ' ' +
                l10n.t('That is a {ratio}× peak-to-average burst on a mostly-idle baseline.', { ratio }) +
                ' ' +
                l10n.t(
                    'For this duty cycle, autoscale tracks demand more efficiently than fixed throughput sized for the peak.',
                ),
        ),
        suggestedAction:
            containerId && recommendedMax !== undefined
                ? l10n.t('Enable autoscale on "{container}" and start with a maximum near {recommended} RU/s.', {
                      container: containerId,
                      recommended: recommendedMax.toLocaleString(),
                  }) +
                  ' ' +
                  l10n.t('This ceiling still covers the observed peak with headroom.')
                : l10n.t(
                      'Enable autoscale on the bursty containers so provisioned RU/s follows demand between the configured floor and ceiling.',
                  ),
        thresholdReference: l10n.t('Threshold: peak ≥ {max}%, average ≤ {avg}%, and peak/average ≥ {ratio}×', {
            max: thresholds.maxPercent,
            avg: thresholds.avgPercent,
            ratio: thresholds.peakToAvgRatio,
        }),
        scope,
    };
}

function evaluateManualThroughput(
    input: ManualThroughputInput,
    thresholds: AutoscaleThresholds,
): DerivedAdvisory | undefined {
    const samples = finiteNumbers(input.ruPercents);
    if (
        samples.length < DIAGNOSTIC_POLICY.overProvisioning.minSamples ||
        !hasMinimumKnownResourceAge(input.resourceAgeDays, DIAGNOSTIC_POLICY.overProvisioning.minResourceAgeDays)
    ) {
        return undefined;
    }
    return evaluateAutoscaleCandidate(
        input.peakPercent ?? (samples.length > 0 ? Math.max(...samples) : undefined),
        mean(samples),
        thresholds,
        true,
        input.provisionedRu,
        containerKey(input.databaseId, input.containerId),
        input.containerId,
        '30 days',
    );
}

export class AutoscaleCandidateDetector extends Detector {
    readonly rule = 'AutoscaleCandidate' as const;
    readonly supersedes = ['OverProvisioning'] as const;
    evaluate = evaluateAutoscaleCandidate;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const { inputs, thresholds } = ctx;
        const dutyCycle = {
            maxPercent: thresholds.autoscaleMaxPercent,
            avgPercent: thresholds.autoscaleAvgPercent,
            peakToAvgRatio: thresholds.autoscalePeakToAvgRatio,
        };
        if (inputs.manualThroughput !== undefined) {
            return inputs.manualThroughput
                .map((input) => evaluateManualThroughput(input, dutyCycle))
                .filter((advisory): advisory is DerivedAdvisory => advisory !== undefined);
        }
        const advisory = this.evaluate(
            inputs.weeklyPeakPercent ??
                (inputs.weeklyRuPercents.length > 0 ? Math.max(...inputs.weeklyRuPercents) : undefined),
            inputs.weeklyRuPercents.length > 0 ? mean(inputs.weeklyRuPercents) : undefined,
            dutyCycle,
            inputs.hasManualThroughput,
        );
        return advisory ? [advisory] : [];
    }
}

export const autoscaleCandidateDetector = new AutoscaleCandidateDetector();
