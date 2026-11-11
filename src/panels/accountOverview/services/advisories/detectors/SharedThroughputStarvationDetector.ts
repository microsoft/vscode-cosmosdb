/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type AdvisoryEvaluation,
    type CollectionTrafficInput,
    type DerivedAdvisory,
    type SharedThroughputInput,
    type SharedThroughputThresholds,
} from '../core/types';

/**
 * SharedThroughputStarvation (CODA DX-003): in a shared-throughput database one collection monopolizes the
 * database-level RU pool, starving its siblings — they throttle despite consuming little while the pool is at
 * its cap. Fires when ≥ 2 collections are active, the pool 429 rate is ≥ `poolThrottlePct`, one collection
 * consumes ≥ `dominancePct` of the pool RU, and a different collection throttles ≥ `victimThrottlePct` while
 * consuming ≤ `victimSharePct`. The internal per-collection RU split is not exposed, so this infers starvation
 * from the 429 + consumption disparity. Database-scoped, High severity. Pure.
 */
function evaluateSharedThroughputStarvation(
    input: SharedThroughputInput,
    thresholds: SharedThroughputThresholds,
): AdvisoryEvaluation<'SharedThroughputStarvation'> {
    if (!input.sharedContainerIds) {
        return { rootCause: 'insufficient_data' };
    }
    const members = new Set(input.sharedContainerIds);
    const traffic = input.collections.filter((c) => members.has(c.containerId));
    if (
        new Set(traffic.map((c) => c.containerId)).size !== traffic.length ||
        traffic.some(
            (c) =>
                !Number.isFinite(c.requests) ||
                c.requests < 0 ||
                !Number.isFinite(c.throttledRequests) ||
                c.throttledRequests < 0 ||
                c.throttledRequests > c.requests ||
                !Number.isFinite(c.ruConsumed) ||
                c.ruConsumed < 0,
        )
    ) {
        return { rootCause: 'insufficient_data' };
    }
    const active = traffic.filter((c) => c.requests >= thresholds.minRequests);
    if (active.length < DIAGNOSTIC_POLICY.sharedThroughput.minActiveCollections) {
        return { rootCause: active.length === 0 ? 'insufficient_data' : 'single_collection' };
    }
    const ruTotal = active.reduce((sum, c) => sum + c.ruConsumed, 0);
    const reqTotal = active.reduce((sum, c) => sum + c.requests, 0);
    const thrTotal = active.reduce((sum, c) => sum + c.throttledRequests, 0);
    const poolRate = reqTotal > 0 ? (100 * thrTotal) / reqTotal : 0;
    if (ruTotal <= 0) {
        return { rootCause: 'insufficient_data' };
    }
    if (poolRate < thresholds.poolThrottlePct) {
        return { rootCause: 'not_throttling' };
    }
    const share = (c: CollectionTrafficInput): number => (100 * c.ruConsumed) / ruTotal;
    const throttleRate = (c: CollectionTrafficInput): number =>
        c.requests > 0 ? (100 * c.throttledRequests) / c.requests : 0;
    const monopolizer = active.reduce((top, c) => (share(c) > share(top) ? c : top), active[0]);
    const monoShare = share(monopolizer);
    const victims = active.filter(
        (c) =>
            c.containerId !== monopolizer.containerId &&
            throttleRate(c) >= thresholds.victimThrottlePct &&
            share(c) <= thresholds.victimSharePct,
    );
    if (monoShare < thresholds.dominancePct || victims.length === 0) {
        return { rootCause: 'no_disparity' };
    }
    const victim = victims.reduce((worst, c) => (throttleRate(c) > throttleRate(worst) ? c : worst), victims[0]);
    const advisory: DerivedAdvisory = {
        id: `SharedThroughputStarvation/${input.databaseId}`,
        rule: 'SharedThroughputStarvation',
        severity: 'High',
        scope: input.databaseId,
        title: l10n.t('Shared-throughput starvation in {database}', { database: input.databaseId }),
        rationale: clampRationale(
            l10n.t(
                'Shared-throughput database {database} has `{ru} RU/s` across `{count} collections`. {mono} consumes `{monoShare}%` of the pool.',
                {
                    database: escapeAdvisoryText(input.databaseId),
                    ru: Math.round(input.sharedRu),
                    count: active.length,
                    mono: escapeAdvisoryText(monopolizer.containerId),
                    monoShare: Math.round(monoShare),
                },
            ) +
                ' ' +
                l10n.t(
                    '{victim} throttles at `{victimRate}%` despite using only `{victimShare}%` of the pool. It is being starved.',
                    {
                        victim: escapeAdvisoryText(victim.containerId),
                        victimRate: Math.round(throttleRate(victim)),
                        victimShare: Math.round(share(victim)),
                    },
                ),
        ),
        suggestedAction:
            l10n.t(
                'Move the monopolizing collection (or the starved one) to dedicated throughput, or migrate collections off the shared pool.',
            ) +
            ' ' +
            l10n.t(
                'The exact internal RU split per collection is not exposed; this is inferred from the 429 + consumption disparity.',
            ),
        thresholdReference: l10n.t(
            'Threshold: pool 429 ≥ `{pool}%`, one collection ≥ `{dominance}%` of RU, a sibling throttling ≥ `{victim}%` at ≤ `{share}%` share',
            {
                pool: thresholds.poolThrottlePct,
                dominance: thresholds.dominancePct,
                victim: thresholds.victimThrottlePct,
                share: thresholds.victimSharePct,
            },
        ),
        evidence: { ...input.requestLogEvidence },
    };
    return {
        rootCause: 'starvation',
        advisory,
        observations: { monopolizer: monopolizer.containerId, victim: victim.containerId },
    };
}

export class SharedThroughputStarvationDetector extends Detector {
    readonly rule = 'SharedThroughputStarvation' as const;
    evaluateResult = evaluateSharedThroughputStarvation;
    evaluate = (...args: Parameters<typeof evaluateSharedThroughputStarvation>) =>
        evaluateSharedThroughputStarvation(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const t = ctx.thresholds;
        const out: DerivedAdvisory[] = [];
        for (const input of ctx.inputs.sharedThroughput ?? []) {
            const a = this.evaluate(input, {
                minRequests: t.sharedThroughputMinRequests,
                poolThrottlePct: t.sharedThroughputPoolThrottlePct,
                dominancePct: t.sharedThroughputDominancePct,
                victimThrottlePct: t.sharedThroughputVictimThrottlePct,
                victimSharePct: t.sharedThroughputVictimSharePct,
            });
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const sharedThroughputStarvationDetector = new SharedThroughputStarvationDetector();
