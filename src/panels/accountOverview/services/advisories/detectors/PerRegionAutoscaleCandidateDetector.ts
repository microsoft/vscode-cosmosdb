/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { classifyPerRegionAutoscale } from '../core/helpers';
import { type AccountConfigInput, type AdvisoryEvaluation, type DerivedAdvisory } from '../core/types';

export class PerRegionAutoscaleCandidateDetector extends Detector {
    readonly rule = 'PerRegionAutoscaleCandidate' as const;

    evaluateResult = (config: AccountConfigInput): AdvisoryEvaluation<'PerRegionAutoscaleCandidate'> => {
        const classification = classifyPerRegionAutoscale(config);
        if (classification.rootCause !== 'prpa_candidate') {
            return { rootCause: classification.rootCause };
        }
        const advisory: DerivedAdvisory = {
            id: this.rule,
            rule: this.rule,
            severity: 'Low',
            title: l10n.t('Review per-region and per-partition autoscale'),
            rationale: l10n.t(
                'The account has `{regions} regions` and per-region/per-partition autoscale is reported as disabled. This configuration check does not establish autoscale usage or uneven regional demand.',
                { regions: config.regionCount },
            ),
            suggestedAction: l10n.t(
                'Confirm throughput mode, current feature eligibility and regional/partition demand. If autoscale is used and demand is uneven, evaluate independent scaling. This does not fix a skewed logical key, and savings are not established.',
            ),
            thresholdReference: l10n.t(
                'Threshold: at least `2 regions`, provisioned account and per-region/per-partition autoscale explicitly disabled',
            ),
            evidence: { regionCount: config.regionCount, perRegionPerPartitionAutoscaleEnabled: false },
            actionEligibility: 'requiresValidation',
            agentKitRule: null,
        };
        return { rootCause: 'prpa_candidate', advisory };
    };

    evaluate = (config: AccountConfigInput) => this.evaluateResult(config).advisory;

    run(ctx: DetectorContext): DerivedAdvisory[] {
        const finding = ctx.inputs.accountConfig && this.evaluate(ctx.inputs.accountConfig);
        return finding ? [finding] : [];
    }
}

export const perRegionAutoscaleCandidateDetector = new PerRegionAutoscaleCandidateDetector();
