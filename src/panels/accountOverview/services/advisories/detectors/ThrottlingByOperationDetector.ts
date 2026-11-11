/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { operationCategory, summarizeRequestStatuses, type OperationCategory } from '../core/requestMetrics';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type AccountRequestMetricsInput, type AdvisoryEvaluation, type DerivedAdvisory } from '../core/types';

const CATEGORY_RULE: Record<OperationCategory, string> = {
    write: 'sdk-ingestion-rate-control',
    read: 'partition-avoid-hotspots',
    query: 'query-avoid-cross-partition',
    execute: 'monitoring-ru-consumption',
    other: 'monitoring-throttling',
};

function categoryAction(category: OperationCategory): string {
    switch (category) {
        case 'write':
            return l10n.t(
                'Review ingestion pacing, bulk execution and client-side throughput control before changing capacity.',
            );
        case 'read':
            return l10n.t(
                'Check partition saturation and key distribution to distinguish hotspots from uniform capacity pressure.',
            );
        case 'query':
            return l10n.t(
                'Inspect query diagnostics, partition-key filters and indexing requirements before attributing throttling to fan-out or increasing RU/s.',
            );
        case 'execute':
            return l10n.t('Review stored-procedure/server-side execution RU cost and call rate.');
        case 'other':
            return l10n.t('Review the dominant operation, its call rate, RU cost and SDK retry behavior.');
    }
}

export class ThrottlingByOperationDetector extends Detector {
    readonly rule = 'ThrottlingByOperation' as const;

    evaluateResult = (input: AccountRequestMetricsInput): AdvisoryEvaluation<'ThrottlingByOperation'> => {
        const { totalRequests, totalThrottled } = summarizeRequestStatuses(input.statusCounts);
        const rate = (100 * totalThrottled) / totalRequests;
        const policy = DIAGNOSTIC_POLICY.throttlingByOperation;
        const operations = Object.entries(input.throttledOperationCounts ?? {})
            .filter(([operation, count]) => operation.trim().length > 0 && Number.isFinite(count) && count > 0)
            .sort(([opA, countA], [opB, countB]) => countB - countA || opA.localeCompare(opB));
        if (!Number.isFinite(totalRequests) || totalRequests < DIAGNOSTIC_POLICY.accountRequests.minRequests) {
            return { rootCause: 'too_few_requests' };
        }
        if (!Number.isFinite(rate) || rate < policy.ratePercent || operations.length === 0) {
            return { rootCause: 'not_throttling' };
        }
        const [operation, count] = operations[0];
        const category = operationCategory(operation);
        const evidence: Extract<
            AdvisoryEvaluation<'ThrottlingByOperation'>,
            { rootCause: 'decomposed' }
        >['observations'] = {
            totalRequests,
            totalThrottled,
            throttleRatePercent: rate,
            dominantOperation: operation,
            dominantCategory: category,
            dominantSharePercent: (100 * count) / totalThrottled,
        };
        const categoryCounts = new Map<OperationCategory, number>();
        for (const [op, opCount] of operations) {
            const opCategory = operationCategory(op);
            categoryCounts.set(opCategory, (categoryCounts.get(opCategory) ?? 0) + opCount);
        }
        for (const [key, categoryCount] of categoryCounts) {
            evidence[`${key}SharePercent`] = (100 * categoryCount) / totalThrottled;
        }
        const advisory: DerivedAdvisory = {
            id: this.rule,
            rule: this.rule,
            severity: rate >= policy.highPercent ? 'High' : rate >= policy.mediumPercent ? 'Medium' : 'Low',
            title: l10n.t('Throttling by operation'),
            rationale: clampRationale(
                l10n.t(
                    '`{rate}%` of `{total} requests` were throttled. `{operation}` is the most frequent throttled operation, representing `{share}%` of status-reported 429s. Independent metric breakdowns can differ in completeness; operation mix does not prove a root cause.',
                    {
                        rate: rate.toFixed(2),
                        total: totalRequests,
                        operation: escapeAdvisoryText(operation),
                        share: ((100 * count) / totalThrottled).toFixed(2),
                    },
                ),
            ),
            suggestedAction: categoryAction(category),
            thresholdReference: l10n.t(
                'Threshold: ≥`1,000 requests`, ≥`1%` 429s and a positive operation breakdown; Medium ≥`5%`, High ≥`20%` over seven days',
            ),
            evidence,
            agentKitRule: CATEGORY_RULE[category],
        };
        return { rootCause: 'decomposed', advisory, observations: evidence };
    };

    evaluate = (input: AccountRequestMetricsInput) => this.evaluateResult(input).advisory;

    run(ctx: DetectorContext): DerivedAdvisory[] {
        const finding = ctx.inputs.accountRequests && this.evaluate(ctx.inputs.accountRequests);
        return finding ? [finding] : [];
    }
}

export const throttlingByOperationDetector = new ThrottlingByOperationDetector();
