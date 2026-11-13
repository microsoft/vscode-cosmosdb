/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type AccountConfigInput,
    type AdvisoryEvaluation,
    type ConsistencyReadRuInput,
    type DerivedAdvisory,
} from '../core/types';

// ─── Account-scoped configuration advisories ──────────────────────────────────────
//
// DX-016 and DX-008 trigger from ARM configuration. DX-016 can include optional observed read charge.
// DX-008 can also report configured regional capacity from a complete manual-offer inventory,
// never a savings estimate. Both are account-scoped, so at most one of each fires per account.

/** Consistency levels stronger than the Session default, normalised to lowercase (no separators). */
const PREMIUM_CONSISTENCY_LEVELS: ReadonlySet<string> = new Set(['strong', 'boundedstaleness']);

/** Normalises an ARM consistency level (any casing / separators) to the lowercase token used for comparison. */
function normalizeConsistency(level: string | undefined): string {
    return (level ?? '').split('.').pop()!.replace(/[_\s]/g, '').trim().toLowerCase();
}

/**
 * ExpensiveConsistency (CODA DX-016): the account runs a premium consistency level (Strong or Bounded Staleness)
 * Strong also applies to a known single region because of local quorum read cost.
 * Multi-region guidance separately considers cross-region write latency. Strong is Medium, Bounded Staleness is Low.
 * Pure.
 */
function evaluateExpensiveConsistency(
    config: AccountConfigInput,
    readCharge?: ConsistencyReadRuInput,
): AdvisoryEvaluation<'ExpensiveConsistency'> {
    const level = normalizeConsistency(config.consistencyLevel);
    if (!level) {
        return { rootCause: 'unknown' };
    }
    if (!PREMIUM_CONSISTENCY_LEVELS.has(level)) {
        return { rootCause: 'default_or_relaxed' };
    }
    if (!Number.isInteger(config.regionCount) || config.regionCount < 1) {
        return { rootCause: 'unknown' };
    }
    if (
        config.regionCount <
        (level === 'strong'
            ? DIAGNOSTIC_POLICY.expensiveConsistency.minStrongRegions
            : DIAGNOSTIC_POLICY.expensiveConsistency.minBoundedStalenessRegions)
    ) {
        return { rootCause: 'single_region' };
    }
    const isStrong = level === 'strong';
    const displayLevel = config.consistencyLevel ?? (isStrong ? 'Strong' : 'Bounded Staleness');
    const observed =
        readCharge?.status === 'observed' &&
        Number.isSafeInteger(readCharge.readRequests) &&
        readCharge.readRequests > 0 &&
        Number.isFinite(readCharge.readRu) &&
        readCharge.readRu >= 0
            ? readCharge
            : undefined;
    const advisory: DerivedAdvisory = {
        id: 'ExpensiveConsistency',
        rule: 'ExpensiveConsistency',
        severity: isStrong ? 'Medium' : 'Low',
        title: l10n.t('Review stronger consistency requirements'),
        rationale: clampRationale(
            l10n.t('This account uses {level} consistency across `{regions} regions`.', {
                level: displayLevel,
                regions: config.regionCount,
            }) +
                ' ' +
                l10n.t('Quorum reads can cost more RU than Session or Eventual consistency.') +
                ' ' +
                (config.regionCount > 1
                    ? l10n.t(
                          'Across multiple regions, review the additional write-latency and availability trade-offs.',
                      )
                    : l10n.t('In one region this is a local read-cost review, not a cross-region latency finding.')),
        ),
        suggestedAction:
            l10n.t('Confirm the application genuinely needs this consistency level.') +
            ' ' +
            l10n.t(
                'Consider Session only after validating application correctness and request-level overrides; Session is not equivalent to global Strong consistency.',
            ) +
            ' ' +
            l10n.t(
                'The account has one default consistency level. For load-balanced applications, pass the Cosmos response SessionToken through the web tier to the end-user client in a cookie or equivalent client context.',
            ) +
            ' ' +
            l10n.t(
                'On a later web request, pass the token into the Cosmos request options of whichever SDK instance handles that request. There is no direct SDK-to-SDK synchronization; tokens remain opaque, partition-bound and are not equivalent to Strong consistency.',
            ) +
            (observed
                ? ' ' +
                  l10n.t(
                      'Request logs observed `{ru} read RU` across `{requests} requests`. Half (`{bound} RU`) is only a theoretical upper bound on avoidable read charge: logs do not reveal per-request consistency overrides. This is not measured or monetary savings.',
                      {
                          ru: observed.readRu.toFixed(2),
                          requests: observed.readRequests,
                          bound: (observed.readRu / 2).toFixed(2),
                      },
                  )
                : ''),
        evidence: {
            consistencyLevel: level,
            regionCount: config.regionCount,
            readRuStatus: observed
                ? 'observed'
                : readCharge?.status === 'noObservations'
                  ? 'noObservations'
                  : 'unavailable',
            ...(observed
                ? {
                      sourceTable: observed.sourceTable,
                      sourceResolution: observed.sourceResolution,
                      observationStart: observed.observationStart,
                      observationEnd: observed.observationEnd,
                      observedReadRequests: observed.readRequests,
                      observedReadRu: observed.readRu,
                      upperBoundAvoidableReadRu: observed.readRu / 2,
                  }
                : {}),
        },
        actionEligibility: 'requiresValidation',
        thresholdReference: l10n.t('Threshold: Strong in ≥ `1 region`, or Bounded Staleness in ≥ `2 regions`'),
    };
    return { rootCause: config.regionCount === 1 ? 'strong_single_region' : 'premium_multi_region', advisory };
}

export class ExpensiveConsistencyDetector extends Detector {
    readonly rule = 'ExpensiveConsistency' as const;
    evaluateResult = evaluateExpensiveConsistency;
    evaluate = (...args: Parameters<typeof evaluateExpensiveConsistency>) =>
        evaluateExpensiveConsistency(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        if (!ctx.inputs.accountConfig) {
            return [];
        }
        const advisory = this.evaluate(ctx.inputs.accountConfig, ctx.inputs.consistencyReadRu);
        return advisory ? [advisory] : [];
    }
}

export const expensiveConsistencyDetector = new ExpensiveConsistencyDetector();
