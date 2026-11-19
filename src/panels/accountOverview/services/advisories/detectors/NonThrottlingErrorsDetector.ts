/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { summarizeRequestStatuses } from '../core/requestMetrics';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type AccountRequestMetricsInput, type DerivedAdvisory, type RequestErrorEvaluation } from '../core/types';

export class NonThrottlingErrorsDetector extends Detector {
    readonly rule = 'NonThrottlingErrors' as const;

    evaluateResult(input: AccountRequestMetricsInput): RequestErrorEvaluation {
        const { totalRequests, totalErrors, errors } = summarizeRequestStatuses(input.statusCounts);
        const policy = DIAGNOSTIC_POLICY.nonThrottlingErrors;
        const rate = totalRequests > 0 ? (100 * totalErrors) / totalRequests : 0;
        const observed = { errorRatePercent: Number(rate.toFixed(2)) };
        if (!Number.isFinite(totalRequests) || totalRequests < DIAGNOSTIC_POLICY.accountRequests.minRequests) {
            return { ...observed, rootCause: 'too_few_requests' };
        }
        if (!Number.isFinite(rate) || rate < policy.ratePercent) {
            return { ...observed, rootCause: 'clean' };
        }
        const dominant = [...errors].sort(([codeA, countA], [codeB, countB]) => countB - countA || codeA - codeB)[0];
        if (!dominant) {
            return { ...observed, rootCause: 'clean' };
        }
        const [status] = dominant;
        const conditionalCreate = status === 404 || status === 409;
        const agentKitRule = conditionalCreate
            ? 'sdk-conditional-create-etag'
            : status === 412
              ? 'sdk-etag-concurrency'
              : null;
        const investigation = l10n.t(
            'Account-level status counts alone do not identify an operation or item or establish a read-404-then-insert sequence. Investigate request-level evidence before selecting a remediation.',
        );
        const specificAction = conditionalCreate
            ? l10n.t(
                  'Check expected missing-item lookups, id and partition-key context. Only if code or traces confirm existence-check-before-create, review SDK-appropriate atomic create and 409 handling. Upsert can overwrite data; a 404 supplies no ETag. Do not assume .NET IfNoneMatchEtag protects writes.',
              )
            : status === 412
              ? l10n.t(
                    'Inspect the actual operation and ETag/precondition handling. A 412 can be expected concurrency protection, not proof of missing control or a hot item. For confirmed read-modify-write, re-read state and ETag, reapply the update and retry with bounded attempts. Surface unresolved conflicts; do not drop preconditions.',
                )
              : l10n.t(
                    'Investigate request validation, access, configuration, SDK retries or service health as appropriate for the status. Status counts do not identify a missing role or firewall setting; 5xx can be service-side. Increasing throughput is not a general remedy for non-429 failures.',
                );
        const suggestedAction = investigation + ' ' + specificAction;
        const evidence: NonNullable<DerivedAdvisory['evidence']> = {
            totalRequests,
            totalErrors,
            errorRatePercent: rate,
            dominantStatus: status,
            guidance: suggestedAction,
        };
        for (const [code, count] of errors) {
            evidence[`status${code}Count`] = count;
            evidence[`status${code}RatePercent`] = (100 * count) / totalRequests;
        }
        const advisory: DerivedAdvisory = {
            id: this.rule,
            rule: this.rule,
            severity: rate >= policy.highPercent ? 'High' : rate >= policy.mediumPercent ? 'Medium' : 'Low',
            title: l10n.t('Non-throttling request errors'),
            rationale: l10n.t(
                '`{rate}%` of `{total} requests` returned status ≥400 excluding 429. The most frequent error was `{status}`. Account-level counts do not identify an application, container, operation or item, or prove an application defect.',
                { rate: rate.toFixed(2), total: totalRequests, status },
            ),
            suggestedAction,
            thresholdReference: l10n.t(
                'Threshold: ≥`1,000 requests` and ≥`1%` non-429 errors; Medium ≥`5%`, High ≥`10%` over seven days',
            ),
            evidence,
            agentKitRule,
        };
        return { ...observed, rootCause: 'has_errors', dominantStatus: status, advisory };
    }

    evaluate(input: AccountRequestMetricsInput): DerivedAdvisory | undefined {
        return this.evaluateResult(input).advisory;
    }

    run(ctx: DetectorContext): DerivedAdvisory[] {
        const finding = ctx.inputs.accountRequests && this.evaluate(ctx.inputs.accountRequests);
        return finding ? [finding] : [];
    }
}

export const nonThrottlingErrorsDetector = new NonThrottlingErrorsDetector();
