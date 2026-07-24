/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DerivedAdvisory, type DerivedAdvisorySeverity } from './types';

const ADVISORY_SEVERITY_ORDER: Record<DerivedAdvisorySeverity, number> = { High: 0, Medium: 1, Low: 2 };

/** Sorts advisories by severity (High first), then rule, then scope. Pure. */
export function compareAdvisories(a: DerivedAdvisory, b: DerivedAdvisory): number {
    return (
        ADVISORY_SEVERITY_ORDER[a.severity] - ADVISORY_SEVERITY_ORDER[b.severity] ||
        a.rule.localeCompare(b.rule) ||
        (a.scope ?? '').localeCompare(b.scope ?? '')
    );
}

/** Defensive clamp so a rationale never exceeds the 500-char budget. */
export function clampRationale(text: string): string {
    return text.length <= 500 ? text : text.slice(0, 499) + '…';
}

/** Arithmetic mean of the finite values in a series; 0 for an empty series. Pure. */
export function mean(values: readonly number[]): number {
    const clean = values.filter((v) => Number.isFinite(v));
    if (clean.length === 0) {
        return 0;
    }
    return clean.reduce((sum, v) => sum + v, 0) / clean.length;
}

// ─── Shared capacity-materiality severity (CODA framework/materiality) ─────────────
//
// The cost-oriented rules (DX-001 over-provisioning, DX-004 idle, DX-011 autoscale-max) grade severity by
// **relative materiality in capacity terms**: a finding's recoverable/wasted RU/s as a percentage of the scope's
// total provisioned RU/s (the same waste is material against a small account, trivial against a fleet). When the
// scope total is unknown the model falls back to absolute-RU bands. CODA reports capacity, not cost (ADR-0012).

/** Recoverable RU/s as % of scope provisioned RU/s at or above which severity is High. */
const MATERIALITY_HIGH_PCT = 5;
/** Recoverable RU/s as % of scope provisioned RU/s at or above which severity is Medium (below this, Low). */
const MATERIALITY_MEDIUM_PCT = 1;
/** Absolute recoverable RU/s at or above which severity is High, used only when the scope total is unknown. */
const MATERIALITY_ABS_HIGH_RU = 5000;
/** Absolute recoverable RU/s at or above which severity is Medium, used only when the scope total is unknown. */
const MATERIALITY_ABS_MEDIUM_RU = 1000;

/**
 * Maps a finding's RU/s (recoverable for idle, wasted for over-provisioning) to a severity — relative to the
 * scope's provisioned RU/s when known, else an absolute-RU fallback. Shared so DX-001/DX-004/DX-011 stay
 * consistent (CODA framework/materiality, ADR-0012). Pure.
 */
export function capacityMaterialitySeverity(
    findingRu: number,
    scopeProvisionedRu: number | undefined,
): DerivedAdvisorySeverity {
    if (scopeProvisionedRu !== undefined && scopeProvisionedRu > 0) {
        const pct = (findingRu / scopeProvisionedRu) * 100;
        if (pct >= MATERIALITY_HIGH_PCT) {
            return 'High';
        }
        return pct >= MATERIALITY_MEDIUM_PCT ? 'Medium' : 'Low';
    }
    if (findingRu >= MATERIALITY_ABS_HIGH_RU) {
        return 'High';
    }
    return findingRu >= MATERIALITY_ABS_MEDIUM_RU ? 'Medium' : 'Low';
}
