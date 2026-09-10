/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type ScoringWeights } from '../webviews/cosmosdb/DataModeling/models';
import { type PartitionKeyRecommendation, type PkCandidate, PriorityScoresSchema } from './recommendationSchema';

export const DEFAULT_SCORING_WEIGHTS: Readonly<ScoringWeights> = { read: 33.34, write: 33.33, storage: 33.33 };

export const ScoringWeightsSchema = z
    .object({
        read: z.number().min(0).max(100),
        write: z.number().min(0).max(100),
        storage: z.number().min(0).max(100),
    })
    .refine((weights) => Math.abs(weights.read + weights.write + weights.storage - 100) < 0.000001, {
        message: 'Scoring priorities must total 100%.',
    });

/** Sort using the unrounded score; round only when presenting the result. */
export function weightedScore(scores: z.infer<typeof PriorityScoresSchema>, weights: ScoringWeights): number {
    const validScores = PriorityScoresSchema.parse(scores);
    const validWeights = ScoringWeightsSchema.parse(weights);
    return (
        (validScores.read * validWeights.read +
            validScores.write * validWeights.write +
            validScores.storage * validWeights.storage) /
        100
    );
}

/** Deterministic ranking of skill-grounded component scores; does not mutate the LLM response. */
export function rankRecommendation(
    recommendation: PartitionKeyRecommendation,
    weights: ScoringWeights,
): PartitionKeyRecommendation {
    ScoringWeightsSchema.parse(weights);
    return {
        ...recommendation,
        containers: recommendation.containers.map((container) => {
            if (!container.candidates?.length || container.candidates.some((candidate) => !candidate.priorityScores)) {
                throw new Error('Every partition-key candidate must include all three priority scores.');
            }
            const candidates: PkCandidate[] = container.candidates
                .map((candidate) => ({
                    ...candidate,
                    score: weightedScore(PriorityScoresSchema.parse(candidate.priorityScores), weights),
                }))
                .sort((a, b) => b.score - a.score);
            const best = candidates[0];
            const worst = candidates[candidates.length - 1];
            for (const candidate of candidates) {
                candidate.verdict =
                    candidate.score === best.score
                        ? 'recommended'
                        : candidate.score === worst.score
                          ? 'avoid'
                          : 'alternative';
            }
            const changedWinner = best.partitionKey !== container.partitionKey;
            return {
                ...container,
                partitionKey: best.partitionKey,
                rationale:
                    best.rationale ??
                    (changedWinner ? best.assessments.map((a) => a.detail).join(' ') : container.rationale),
                candidates,
                // Container-level analysis from the model only applies to its original choice.
                queryRouting: changedWinner ? undefined : container.queryRouting,
                documentIdStrategy: changedWinner ? undefined : container.documentIdStrategy,
                alternatives: undefined,
                avoid: undefined,
            };
        }),
    };
}
