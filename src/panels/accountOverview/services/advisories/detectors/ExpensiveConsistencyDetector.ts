/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type AccountConfigInput, type DerivedAdvisory } from '../core/types';

// ─── Account-scoped configuration advisories (ARM config only) ─────────────────────
//
// DX-016 and DX-008 read only the account's ARM configuration — no workload, no metrics — and surface
// qualitative antipatterns (they explain the consequence and ask the customer to confirm intent; they assert
// no RU/s or dollar figure). Both are account-scoped, so at most one of each fires per account.

/** Consistency levels stronger than the Session default, normalised to lowercase (no separators). */
const PREMIUM_CONSISTENCY_LEVELS: ReadonlySet<string> = new Set(['strong', 'boundedstaleness']);

/** Normalises an ARM consistency level (any casing / separators) to the lowercase token used for comparison. */
function normalizeConsistency(level: string | undefined): string {
    return (level ?? '').split('.').pop()!.replace(/[_\s]/g, '').trim().toLowerCase();
}

/**
 * ExpensiveConsistency (CODA DX-016): the account runs a premium consistency level (Strong or Bounded Staleness)
 * across two or more regions. Across multiple regions these levels make writes wait on additional regions, raising
 * write latency and tightening availability; the default Session consistency suits most workloads. On a single
 * region the cross-region cost does not apply, so it never fires there. Strong is Medium, Bounded Staleness is Low.
 * Pure.
 */
function evaluateExpensiveConsistency(config: AccountConfigInput): DerivedAdvisory | undefined {
    const level = normalizeConsistency(config.consistencyLevel);
    if (!PREMIUM_CONSISTENCY_LEVELS.has(level) || config.regionCount < 2) {
        return undefined;
    }
    const isStrong = level === 'strong';
    const displayLevel = config.consistencyLevel ?? (isStrong ? 'Strong' : 'Bounded Staleness');
    return {
        id: 'ExpensiveConsistency',
        rule: 'ExpensiveConsistency',
        severity: isStrong ? 'Medium' : 'Low',
        title: l10n.t('Premium consistency across regions'),
        rationale: clampRationale(
            l10n.t(
                'This account uses {level} consistency across {regions} regions. Across multiple regions this level raises write latency and tightens availability (Strong makes writes wait on additional regions), and the default Session consistency is sufficient for most workloads.',
                { level: displayLevel, regions: config.regionCount },
            ),
        ),
        suggestedAction: l10n.t(
            'Confirm the application genuinely needs this consistency level; if not, relax it to Session (or Bounded Staleness) after validating the application’s tolerance.',
        ),
        thresholdReference: l10n.t('Threshold: Strong or Bounded Staleness across ≥ 2 regions'),
    };
}

export class ExpensiveConsistencyDetector extends Detector {
    readonly rule = 'ExpensiveConsistency' as const;
    evaluate = evaluateExpensiveConsistency;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        if (!ctx.inputs.accountConfig) {
            return [];
        }
        const advisory = this.evaluate(ctx.inputs.accountConfig);
        return advisory ? [advisory] : [];
    }
}

export const expensiveConsistencyDetector = new ExpensiveConsistencyDetector();
