/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type AdvisoryEvaluation, type DerivedAdvisory } from '../core/types';

export class ReservedCapacityCandidateDetector extends Detector {
    readonly rule = 'ReservedCapacityCandidate' as const;

    evaluateResult = (
        provisionedRu: number | undefined,
        isServerless: boolean | undefined,
    ): AdvisoryEvaluation<'ReservedCapacityCandidate'> => {
        if (isServerless === true) {
            return { rootCause: 'serverless' };
        }
        if (isServerless !== false || provisionedRu === undefined || !Number.isFinite(provisionedRu)) {
            return { rootCause: 'unknown' };
        }
        if (provisionedRu < DIAGNOSTIC_POLICY.reservedCapacity.minBaselineRu) {
            return { rootCause: 'below_baseline' };
        }
        const advisory: DerivedAdvisory = {
            id: this.rule,
            rule: this.rule,
            severity: 'Low',
            title: l10n.t('Review reserved-capacity coverage'),
            rationale: l10n.t(
                'Distinct provisioned offers total `{ru} RU/s` (manual allocations plus autoscale maxima). This is a configuration proxy, not a measured stable billable baseline. Low severity describes the review advisory, not utilization or potential savings.',
                { ru: provisionedRu },
            ),
            suggestedAction: l10n.t(
                'Review eligible usage, existing reservation coverage, negotiated rates and future demand in Cost Management before considering a one- or three-year commitment. This check does not establish that reservations are absent or quantify a discount.',
            ),
            thresholdReference: l10n.t(
                'Threshold: at least `{ru} RU/s` of provisioned capacity; constant Low severity',
                {
                    ru: DIAGNOSTIC_POLICY.reservedCapacity.minBaselineRu,
                },
            ),
            evidence: { provisionedRu },
            actionEligibility: 'requiresValidation',
            agentKitRule: null,
        };
        return { rootCause: 'reserved_candidate', advisory };
    };

    evaluate = (provisionedRu: number | undefined, isServerless: boolean | undefined) =>
        this.evaluateResult(provisionedRu, isServerless).advisory;

    run(ctx: DetectorContext): DerivedAdvisory[] {
        const finding = this.evaluate(ctx.inputs.scopeProvisionedRuTotal, ctx.inputs.accountConfig?.isServerless);
        return finding ? [finding] : [];
    }
}

export const reservedCapacityCandidateDetector = new ReservedCapacityCandidateDetector();
