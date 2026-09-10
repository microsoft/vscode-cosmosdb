/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createInitialState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { ModelingAdvisorSnapshotSchema } from './modelingAdvisorSchema';
import { type PartitionKeyRecommendation, type PkCandidate } from './recommendationSchema';
import { DEFAULT_SCORING_WEIGHTS, rankRecommendation, ScoringWeightsSchema, weightedScore } from './scoring';

function candidate(key: string, read: number, write: number, storage: number): PkCandidate {
    return {
        partitionKey: key,
        priorityScores: { read, write, storage },
        score: 999,
        verdict: 'recommended',
        assessments: [],
        rationale: `${key} rationale`,
    };
}

function recommendation(candidates: PkCandidate[]): PartitionKeyRecommendation {
    return {
        summary: 'Candidate comparison',
        containers: [
            {
                entity: 'Orders',
                partitionKey: '/read',
                rationale: 'original',
                candidates,
                queryRouting: { headline: 'Read-key routing', routes: [], analysis: 'Only for /read' },
                documentIdStrategy: { tag: 'ID', recommendation: 'Only for /read' },
            },
        ],
    };
}

describe('priority scoring', () => {
    it('starts near one third for each dimension and totals exactly 100', () => {
        expect(createInitialState().weights).toEqual(DEFAULT_SCORING_WEIGHTS);
        expect(DEFAULT_SCORING_WEIGHTS.read + DEFAULT_SCORING_WEIGHTS.write + DEFAULT_SCORING_WEIGHTS.storage).toBe(
            100,
        );
        expect(weightedScore({ read: 90, write: 70, storage: 80 }, DEFAULT_SCORING_WEIGHTS)).toBeCloseTo(80.001, 10);
    });

    it.each([
        { read: 100, write: 0, storage: 0, expected: 90 },
        { read: 0, write: 100, storage: 0, expected: 70 },
        { read: 0, write: 0, storage: 100, expected: 80 },
        { read: 50, write: 30, storage: 20, expected: 82 },
    ])('computes the normalized score for %j', ({ expected, ...weights }) => {
        expect(weightedScore({ read: 90, write: 70, storage: 80 }, weights)).toBe(expected);
        expect(weightedScore({ read: 100, write: 100, storage: 100 }, weights)).toBe(100);
        expect(weightedScore({ read: 0, write: 0, storage: 0 }, weights)).toBe(0);
    });

    it.each([
        { read: 0, write: 0, storage: 0 },
        { read: 101, write: -1, storage: 0 },
        { read: 33, write: 33, storage: 33 },
        { read: NaN, write: 50, storage: 50 },
        { read: Infinity, write: 0, storage: 0 },
    ])('rejects invalid priorities %j', (weights) => {
        expect(ScoringWeightsSchema.safeParse(weights).success).toBe(false);
    });

    it('overrides model scores and verdicts, sorts and changes the winner without mutating source', () => {
        const original = recommendation([
            candidate('/read', 90, 20, 50),
            candidate('/write', 20, 90, 60),
            candidate('/balanced', 70, 70, 70),
        ]);
        const ranked = rankRecommendation(original, { read: 10, write: 80, storage: 10 }).containers[0];
        expect(ranked.candidates?.map((c) => [c.partitionKey, c.score, c.verdict])).toEqual([
            ['/write', 80, 'recommended'],
            ['/balanced', 70, 'alternative'],
            ['/read', 30, 'avoid'],
        ]);
        expect(ranked.partitionKey).toBe('/write');
        expect(ranked.rationale).toBe('/write rationale');
        expect(ranked.queryRouting).toBeUndefined();
        expect(ranked.documentIdStrategy).toBeUndefined();
        expect(original.containers[0].partitionKey).toBe('/read');
        expect(original.containers[0].candidates?.[0].score).toBe(999);
        expect(rankRecommendation(original, { read: 100, write: 0, storage: 0 }).containers[0].queryRouting).toEqual(
            original.containers[0].queryRouting,
        );
    });

    it('keeps exact ties stable and never labels tied best candidates worst', () => {
        const ranked = rankRecommendation(
            recommendation([candidate('/a', 60, 60, 60), candidate('/b', 60, 60, 60)]),
            DEFAULT_SCORING_WEIGHTS,
        ).containers[0].candidates!;
        expect(ranked.map((c) => c.partitionKey)).toEqual(['/a', '/b']);
        expect(ranked.map((c) => c.verdict)).toEqual(['recommended', 'recommended']);
        expect(
            rankRecommendation(recommendation([candidate('/a', 0, 0, 0)]), DEFAULT_SCORING_WEIGHTS).containers[0]
                .candidates?.[0].verdict,
        ).toBe('recommended');
    });

    it('ranks on full precision rather than rounded display scores', () => {
        const ranked = rankRecommendation(
            recommendation([candidate('/a', 80, 80, 80), candidate('/b', 80.001, 80, 80)]),
            DEFAULT_SCORING_WEIGHTS,
        ).containers[0].candidates!;
        expect(ranked[0].partitionKey).toBe('/b');
        expect(ranked[0].score).toBeGreaterThan(80);
    });

    it.each([
        { read: NaN, write: 50, storage: 50 },
        { read: 50, write: Infinity, storage: 50 },
        { read: 50, write: 50, storage: -1 },
        { read: 50, write: 50, storage: 101 },
    ])('rejects invalid LLM scores %j', (scores) => {
        expect(() => weightedScore(scores, DEFAULT_SCORING_WEIGHTS)).toThrow(ZodError);
    });

    it('does not invent component scores for legacy results', () => {
        const legacy = recommendation([
            { partitionKey: '/legacy', score: 90, verdict: 'recommended', assessments: [] },
        ]);
        expect(() => rankRecommendation(legacy, DEFAULT_SCORING_WEIGHTS)).toThrow('all three priority scores');
        const saved = ModelingAdvisorSnapshotSchema.parse({
            wizard: createInitialState(),
            recommendation: { status: 'received', value: legacy },
        });
        expect(saved.recommendation.weights).toBeUndefined();
        expect(saved.recommendation.value?.containers[0].candidates?.[0].priorityScores).toBeUndefined();
    });

    it('persists applied weights separately from later Review edits', () => {
        const saved = ModelingAdvisorSnapshotSchema.parse({
            wizard: { ...createInitialState(), weights: { read: 10, write: 80, storage: 10 } },
            recommendation: {
                status: 'received',
                weights: DEFAULT_SCORING_WEIGHTS,
                value: rankRecommendation(recommendation([candidate('/a', 90, 70, 80)]), DEFAULT_SCORING_WEIGHTS),
            },
        });
        expect(saved.recommendation.weights).toEqual(DEFAULT_SCORING_WEIGHTS);
        expect(saved.wizard.weights).toEqual({ read: 10, write: 80, storage: 10 });
        expect(saved.recommendation.value?.containers[0].candidates?.[0].score).toBeCloseTo(80.001, 10);
    });
});
