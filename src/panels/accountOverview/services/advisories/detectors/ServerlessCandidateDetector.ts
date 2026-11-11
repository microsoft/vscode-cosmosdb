/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type AdvisoryEvaluation,
    type DerivedAdvisory,
    type ServerlessCandidateInput,
    type ServerlessCandidateThresholds,
} from '../core/types';

/**
 * ServerlessCandidate (CODA DX-014): the account's total consumed throughput is **low and sporadic** — a small
 * peak with long idle stretches (a low average-to-peak ratio). Serverless bills per RU with no provisioned floor,
 * so it wins for this shape. Candidate ⇔ enough history AND peak in `(peakFloor, peakCeiling]` RU/s AND
 * average/peak < `sporadicRatio`. An account already on serverless, or one whose peak is below the floor (idle —
 * that is DX-004) or above the ceiling (too large for serverless), is not a candidate. Migration-class, so
 * qualitative Low severity. Account-scoped. Pure.
 */
function evaluateServerlessCandidate(
    input: ServerlessCandidateInput,
    thresholds: ServerlessCandidateThresholds,
): AdvisoryEvaluation<'ServerlessCandidate'> {
    if (input.isServerless) {
        return { rootCause: 'already_serverless' };
    }
    if (input.sampleCount < DIAGNOSTIC_POLICY.serverless.minSamples) {
        return { rootCause: 'insufficient_data' };
    }
    if (input.peakRuPerSec < thresholds.peakFloorRuPerSec) {
        return { rootCause: 'idle_or_empty' };
    }
    if (input.peakRuPerSec > thresholds.peakCeilingRuPerSec) {
        return { rootCause: 'too_high' };
    }
    const ratio = input.peakRuPerSec > 0 ? input.avgRuPerSec / input.peakRuPerSec : 0;
    if (ratio >= thresholds.sporadicRatio) {
        return { rootCause: 'steady_load' };
    }
    const peak = Math.round(input.peakRuPerSec);
    const avg = Math.round(input.avgRuPerSec);
    const ratioPct = Math.round(ratio * 100);
    const advisory: DerivedAdvisory = {
        id: 'ServerlessCandidate',
        rule: 'ServerlessCandidate',
        severity: 'Low',
        title: l10n.t('Account may suit serverless'),
        rationale: clampRationale(
            l10n.t(
                'Account throughput is low and sporadic: peak `{peak} RU/s`, average `{avg} RU/s` (a `{ratio}%` average-to-peak with long idle stretches).',
                { peak, avg, ratio: ratioPct },
            ) +
                ' ' +
                l10n.t('Serverless (pay-per-RU, no provisioned floor) may cost less for this shape.'),
        ),
        suggestedAction:
            l10n.t('Evaluate serverless: it is migration-class and requires a new, single-region account.') +
            ' ' +
            l10n.t(
                'It has no shared-throughput databases and a `5,000 RU/s` per-partition cap. Validate those constraints fit before migrating data.',
            ),
        thresholdReference: l10n.t('Threshold: peak in `({floor}, {ceiling}] RU/s` and average/peak < `{ratio}`', {
            floor: Math.round(thresholds.peakFloorRuPerSec),
            ceiling: Math.round(thresholds.peakCeilingRuPerSec),
            ratio: thresholds.sporadicRatio,
        }),
    };
    return { rootCause: 'serverless_candidate', advisory };
}

export class ServerlessCandidateDetector extends Detector {
    readonly rule = 'ServerlessCandidate' as const;
    evaluateResult = evaluateServerlessCandidate;
    evaluate = (...args: Parameters<typeof evaluateServerlessCandidate>) =>
        evaluateServerlessCandidate(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const { inputs, thresholds } = ctx;
        if (!inputs.serverless) {
            return [];
        }
        const advisory = this.evaluate(inputs.serverless, {
            sporadicRatio: thresholds.serverlessSporadicRatio,
            peakFloorRuPerSec: thresholds.serverlessPeakFloorRuPerSec,
            peakCeilingRuPerSec: thresholds.serverlessPeakCeilingRuPerSec,
        });
        return advisory ? [advisory] : [];
    }
}

export const serverlessCandidateDetector = new ServerlessCandidateDetector();
