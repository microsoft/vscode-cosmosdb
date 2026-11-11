/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { classifyPaidContinuousBackup } from '../core/helpers';
import { type AccountConfigInput, type AdvisoryEvaluation, type DerivedAdvisory } from '../core/types';

export class PaidContinuousBackupDetector extends Detector {
    readonly rule = 'PaidContinuousBackup' as const;

    evaluateResult = (config: AccountConfigInput): AdvisoryEvaluation<'PaidContinuousBackup'> => {
        const classification = classifyPaidContinuousBackup(config);
        if (classification.rootCause !== 'nonprod_paid_continuous_backup') {
            return { rootCause: classification.rootCause };
        }
        const advisory: DerivedAdvisory = {
            id: this.rule,
            rule: this.rule,
            severity: 'Medium',
            title: l10n.t('Paid continuous backup on a non-production account'),
            rationale: l10n.t(
                'This account has paid continuous-backup retention and is inferred to be non-production. Confirm the environment and recovery requirements with the account owner.',
            ),
            suggestedAction: l10n.t(
                'Review Continuous7Days only if seven days of restore history meets the recovery policy. Older restore points would be lost and restores remain separately chargeable. Do not revert to periodic backup solely for this advisory.',
            ),
            thresholdReference: l10n.t(
                'Threshold: Continuous30Days or Continuous35Days on a positively inferred non-production account',
            ),
            evidence: { continuousTier: classification.tier, inferredEnvironment: classification.inferredEnvironment },
            actionEligibility: 'requiresValidation',
            agentKitRule: null,
        };
        return { rootCause: 'nonprod_paid_continuous_backup', advisory };
    };

    evaluate = (config: AccountConfigInput) => this.evaluateResult(config).advisory;

    run(ctx: DetectorContext): DerivedAdvisory[] {
        const finding = ctx.inputs.accountConfig && this.evaluate(ctx.inputs.accountConfig);
        return finding ? [finding] : [];
    }
}

export const paidContinuousBackupDetector = new PaidContinuousBackupDetector();
