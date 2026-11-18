/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DerivedAdvisory,
    type DerivedAdvisoryInputs,
    type DerivedAdvisoryRule,
    type DerivedAdvisoryThresholds,
    type DetectorCoverage,
} from './types';

/** The already-fetched telemetry + configured thresholds every detector evaluates against. */
export interface DetectorContext {
    inputs: DerivedAdvisoryInputs;
    thresholds: DerivedAdvisoryThresholds;
}

/** Only classifications and the optional finding are needed to summarize an evaluation. */
export type DetectorEvaluation = DerivedAdvisory | { rootCause: 'evaluated' | 'not_applicable' | 'insufficient_data' };

export interface DetectorAnalysis {
    advisories: DerivedAdvisory[];
    coverage: DetectorCoverage;
}

/**
 * Base class for every derived-advisory detector. Each concrete detector emits exactly one rule, owns its own
 * loop over the slice of {@link DetectorContext} it needs, and returns the advisories that fired. Shared helpers
 * (rationale clamping, capacity-materiality severity, scope keys) live here so every detector stays consistent.
 */
export abstract class Detector {
    /** The single rule this detector emits. */
    abstract readonly rule: DerivedAdvisoryRule;
    /**
     * Rules this detector supersedes on the same scope when it fires.
     * The engine retains their advisories with supersededBy set.
     */
    readonly supersedes: readonly DerivedAdvisoryRule[] = [];
    protected readonly notApplicableRootCauses: readonly string[] = [];

    protected abstract evaluateInputs(ctx: DetectorContext): readonly DetectorEvaluation[];

    protected getAdvisory(evaluation: DetectorEvaluation): DerivedAdvisory | undefined {
        return 'rule' in evaluation ? evaluation : undefined;
    }

    /** Preserves the finding-only API for callers that do not need coverage. */
    run(ctx: DetectorContext): DerivedAdvisory[] {
        return this.analyze(ctx).advisories;
    }

    /** Pure per-input coverage; source failures and target availability are added by the collector. */
    analyze(ctx: DetectorContext): DetectorAnalysis {
        const evaluations = this.evaluateInputs(ctx);
        const advisories: DerivedAdvisory[] = [];
        const coverage: DetectorCoverage = {
            rule: this.rule,
            status: 'insufficientData',
            evaluatedCount: 0,
            matchedCount: 0,
            notApplicableCount: 0,
            insufficientDataCount: 0,
            unavailableReasons: [],
        };

        for (const evaluation of evaluations) {
            const advisory = this.getAdvisory(evaluation);
            const classification = 'rule' in evaluation ? 'evaluated' : evaluation.rootCause;

            if (advisory) {
                advisories.push(advisory);
                coverage.matchedCount++;
                coverage.evaluatedCount++;
            } else if (classification === 'insufficient_data') {
                coverage.insufficientDataCount++;
            } else if (classification && this.notApplicableRootCauses.includes(classification)) {
                coverage.notApplicableCount++;
            } else {
                coverage.evaluatedCount++;
            }
        }

        if (coverage.insufficientDataCount > 0) {
            coverage.status =
                coverage.evaluatedCount > 0 || coverage.notApplicableCount > 0 ? 'partial' : 'insufficientData';
        } else if (coverage.evaluatedCount > 0) {
            coverage.status = 'evaluated';
        } else if (coverage.notApplicableCount > 0) {
            coverage.status = 'notApplicable';
        }

        return { advisories, coverage };
    }
}
