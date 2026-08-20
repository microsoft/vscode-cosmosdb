/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Recommendation model for the Result page (prototype).
 *
 * Each partition-key candidate carries three per-axis sub-scores — read (query
 * alignment), write (distribution) and storage (growth/limits). The final score
 * is the user's weighted blend of those axes, so moving the Result-page sliders
 * re-ranks candidates live. Candidates and assessments are derived from the
 * modeled container with lightweight heuristics — no backend call.
 */

import * as l10n from '@vscode/l10n';
import { type ContainerModel, type ScoringWeights } from './models';
import { nextId } from './scenarios';

export type AssessmentIcon = 'pass' | 'fail' | 'info' | 'warn';

export interface AssessmentRow {
    icon: AssessmentIcon;
    rule: string;
    reason: string;
}

export interface CandidateAxes {
    read: number;
    write: number;
    storage: number;
}

export type CandidateType = 'rec' | 'alt' | 'avoid';

export interface PkCandidateResult {
    id: string;
    type: CandidateType;
    badge: string;
    pk: string;
    axes: CandidateAxes;
    rows: AssessmentRow[];
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskRow {
    pk: string;
    /** Relative hot-partition risk, 0 (best) – 100 (worst). */
    pct: number;
    risk: RiskLevel;
}

export interface ContainerResult {
    summary: string;
    candidates: PkCandidateResult[];
    ranking: RiskRow[];
}

/** Weighted 0–100 score for a candidate under the given (un-normalized) weights. */
export function scoreOf(axes: CandidateAxes, weights: ScoringWeights): number {
    const sum = weights.read + weights.write + weights.storage || 1;
    const r = weights.read / sum;
    const w = weights.write / sum;
    const s = weights.storage / sum;
    return Math.round(axes.read * r + axes.write * w + axes.storage * s);
}

function riskLevel(pct: number): RiskLevel {
    if (pct < 40) {
        return 'low';
    }
    if (pct < 70) {
        return 'medium';
    }
    return 'high';
}

const LOW_CARDINALITY = /status|type|state|category|role|plan|tier|priority|kind|level/i;

function toPath(field: string): string {
    return field.startsWith('/') ? field : `/${field}`;
}

/**
 * Build a ranked recommendation for one container. The partition key becomes the
 * recommended candidate; a secondary id/key field is the alternative; a
 * low-cardinality field (or /id fallback) is the "avoid" example.
 */
export function buildContainerResult(container: ContainerModel): ContainerResult {
    const entity = container.entity || l10n.t('Container');
    const pkField = (container.partitionKey || '/id').replace(/^\//, '');
    const others = container.properties.filter((p) => p.name.toLowerCase() !== pkField.toLowerCase());

    const altProp =
        others.find((p) => /id$/i.test(p.name)) ??
        others.find((p) => p.role === 'key' || p.role === 'filter') ??
        others[0];
    const altPk = toPath(altProp?.name ?? 'id');

    const avoidProp = others.find((p) => LOW_CARDINALITY.test(p.name) || p.type === 'boolean');
    let avoidPk = toPath(avoidProp?.name ?? 'id');
    if (avoidPk === toPath(pkField) || avoidPk === altPk) {
        avoidPk = '/id';
    }

    const candidates: PkCandidateResult[] = [
        {
            id: nextId('cand'),
            type: 'rec',
            badge: '✅ ' + l10n.t('Recommended'),
            pk: toPath(pkField),
            axes: { read: 95, write: 90, storage: 88 },
            rows: [
                {
                    icon: 'pass',
                    rule: l10n.t('High cardinality'),
                    reason: l10n.t('{field} spreads writes evenly across logical partitions.', { field: pkField }),
                },
                {
                    icon: 'pass',
                    rule: l10n.t('Query alignment'),
                    reason: l10n.t('Most {entity} lookups filter by {field}.', { entity, field: pkField }),
                },
                {
                    icon: 'info',
                    rule: l10n.t('Growth'),
                    reason: l10n.t('Scales horizontally as data grows.'),
                },
            ],
        },
        {
            id: nextId('cand'),
            type: 'alt',
            badge: '💡 ' + l10n.t('Alternative'),
            pk: altPk,
            axes: { read: 80, write: 72, storage: 76 },
            rows: [
                {
                    icon: 'info',
                    rule: l10n.t('Viable'),
                    reason: l10n.t('{pk} works if queries commonly filter by it.', { pk: altPk }),
                },
                {
                    icon: 'warn',
                    rule: l10n.t('Skew risk'),
                    reason: l10n.t('Verify cardinality is high enough to avoid hot partitions.'),
                },
            ],
        },
        {
            id: nextId('cand'),
            type: 'avoid',
            badge: '❌ ' + l10n.t('Avoid'),
            pk: avoidPk,
            axes: { read: 30, write: 18, storage: 24 },
            rows: [
                {
                    icon: 'fail',
                    rule: l10n.t('Low cardinality'),
                    reason: l10n.t('{field} has few distinct values — creates hot partitions.', {
                        field: avoidPk.replace(/^\//, ''),
                    }),
                },
                {
                    icon: 'fail',
                    rule: l10n.t('Throughput bottleneck'),
                    reason: l10n.t('Concentrates writes on a small number of partitions.'),
                },
            ],
        },
    ];

    const ranking: RiskRow[] = [
        { pk: toPath(pkField), pct: 20, risk: riskLevel(20) },
        { pk: altPk, pct: 55, risk: riskLevel(55) },
        { pk: avoidPk, pct: 85, risk: riskLevel(85) },
    ];

    return {
        summary: l10n.t(
            'Ranked partition-key candidates for {entity} by cardinality, query alignment, and hot-partition risk.',
            { entity },
        ),
        candidates,
        ranking,
    };
}

/** Sort candidates by weighted score, keeping "avoid" candidates last. */
export function rankCandidates(
    candidates: PkCandidateResult[],
    weights: ScoringWeights,
): (PkCandidateResult & { score: number })[] {
    return candidates
        .map((c) => ({ ...c, score: scoreOf(c.axes, weights) }))
        .sort((a, b) => {
            const rank = (t: CandidateType) => (t === 'avoid' ? 1 : 0);
            if (rank(a.type) !== rank(b.type)) {
                return rank(a.type) - rank(b.type);
            }
            return b.score - a.score;
        });
}
