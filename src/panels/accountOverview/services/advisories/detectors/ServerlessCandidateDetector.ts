/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type DerivedAdvisory, type ServerlessCandidateInput, type ServerlessCandidateThresholds } from '../core/types';

/** DX-014: minimum number of buckets needed to judge the account-total RU shape. */
const SERVERLESS_MIN_POINTS = 24;

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
): DerivedAdvisory | undefined {
    if (input.isServerless || input.sampleCount < SERVERLESS_MIN_POINTS) {
        return undefined;
    }
    if (input.peakRuPerSec < thresholds.peakFloorRuPerSec || input.peakRuPerSec > thresholds.peakCeilingRuPerSec) {
        return undefined;
    }
    const ratio = input.peakRuPerSec > 0 ? input.avgRuPerSec / input.peakRuPerSec : 0;
    if (ratio >= thresholds.sporadicRatio) {
        return undefined;
    }
    const peak = Math.round(input.peakRuPerSec);
    const avg = Math.round(input.avgRuPerSec);
    const ratioPct = Math.round(ratio * 100);
    return {
        id: 'ServerlessCandidate',
        rule: 'ServerlessCandidate',
        severity: 'Low',
        title: l10n.t('Account may suit serverless'),
        rationale: clampRationale(
            l10n.t(
                'Account throughput is low and sporadic: peak {peak} RU/s, average {avg} RU/s (a {ratio}% average-to-peak with long idle stretches). Serverless (pay-per-RU, no provisioned floor) may cost less for this shape.',
                { peak, avg, ratio: ratioPct },
            ),
        ),
        suggestedAction: l10n.t(
            'Evaluate serverless: it is migration-class (a new, single-region account, no shared-throughput databases, 5,000 RU/s per-partition cap), so validate those constraints fit before migrating data.',
        ),
        thresholdReference: l10n.t('Threshold: peak in ({floor}, {ceiling}] RU/s and average/peak < {ratio}', {
            floor: Math.round(thresholds.peakFloorRuPerSec),
            ceiling: Math.round(thresholds.peakCeilingRuPerSec),
            ratio: thresholds.sporadicRatio,
        }),
    };
}

export class ServerlessCandidateDetector extends Detector {
    readonly rule = 'ServerlessCandidate' as const;
    evaluate = evaluateServerlessCandidate;
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
