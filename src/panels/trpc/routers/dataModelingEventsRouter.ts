/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TypedEventSink } from '@microsoft/vscode-ext-webview';
import { z } from 'zod';
import { dataModelingProcedure, dataModelingRouter } from '../trpc';

// ─── Partition-key recommendation shape ─────────────────────────────────────
// Produced by Copilot via the `cosmosdb_reportPartitionKeyRecommendation` tool
// and streamed to the Data Modeling webview's Result page. The tool's
// package.json `inputSchema` mirrors this shape.

const CandidateNoteSchema = z.object({
    partitionKey: z.string(),
    reason: z.string(),
});

/** One evaluated rule for a partition-key candidate (e.g. "Query match", "Cardinality"). */
const CandidateAssessmentSchema = z.object({
    /** Short rule name, e.g. "Query match", "Cardinality", "Write dist.". */
    label: z.string(),
    /** How the candidate fares on this rule. */
    status: z.enum(['pass', 'warn', 'fail', 'info']),
    /** One-line explanation of the verdict. */
    detail: z.string(),
});

/** A scored partition-key candidate shown as a card on the Result page. */
const PkCandidateSchema = z.object({
    /** Candidate partition-key path, e.g. `/conversationId`. */
    partitionKey: z.string(),
    /** Ranking verdict; drives the card color and badge. */
    verdict: z.enum(['recommended', 'alternative', 'avoid']),
    /** Overall best-practice score, 0–100 (higher is better). */
    score: z.number(),
    /** Per-rule breakdown explaining the score. */
    assessments: z.array(CandidateAssessmentSchema),
});

/** Relative hot-partition risk for one candidate, used for the comparison bars. */
const HotPartitionRiskSchema = z.object({
    partitionKey: z.string(),
    /** Risk band; drives the bar color and label. */
    risk: z.enum(['low', 'medium', 'high', 'severe']),
    /** Relative skew, 0 (best) – 100 (worst), used for the bar width. */
    pct: z.number(),
});

/** One read pattern and how it routes under the recommended partition key. */
const QueryRouteSchema = z.object({
    /** Read pattern description, e.g. "Get messages in a conversation". */
    pattern: z.string(),
    /** Attribute(s) the query filters on. */
    filters: z.string(),
    /** Peak queries per second as displayed, e.g. "200/s". */
    qps: z.string(),
    /** Whether it is served from a single logical partition or fans out. */
    routing: z.enum(['single', 'cross']),
    /** Rough RU cost as displayed, e.g. "3 RU" or "50–100× RU". */
    estCost: z.string(),
});

/** Query-routing analysis: how reads route under the recommended key. */
const QueryRoutingSchema = z.object({
    /** Headline, e.g. "1/3 reads single-partition with /conversationId". */
    headline: z.string(),
    /** Per-read routing rows. */
    routes: z.array(QueryRouteSchema),
    /** Free-text analysis of cross-partition reads and how to resolve them. */
    analysis: z.string(),
});

/** Document-id strategy guidance for the container. */
const DocumentIdStrategySchema = z.object({
    /** Short access-pattern tag, e.g. "Query-driven access". */
    tag: z.string(),
    /** The recommendation text. */
    recommendation: z.string(),
});

export const ContainerRecommendationSchema = z.object({
    /** Name of the container this recommendation applies to. */
    entity: z.string(),
    /** Recommended partition-key path, e.g. `/customerId` or a hierarchical `/tenantId, /userId`. */
    partitionKey: z.string(),
    /** Why this key is recommended (short markdown/plain text). */
    rationale: z.string(),
    /** Scored partition-key candidates, ordered best first. */
    candidates: z.array(PkCandidateSchema).optional(),
    /** Hot-partition risk comparison across candidates. */
    hotPartitionRisk: z.array(HotPartitionRiskSchema).optional(),
    /** How the container's reads route under the recommended key. */
    queryRouting: QueryRoutingSchema.optional(),
    /** Document-id strategy guidance. */
    documentIdStrategy: DocumentIdStrategySchema.optional(),
    /** Viable alternatives with a short note each (legacy/simple summary). */
    alternatives: z.array(CandidateNoteSchema).optional(),
    /** Keys to avoid with the reason each is a poor fit (legacy/simple summary). */
    avoid: z.array(CandidateNoteSchema).optional(),
});

export const PartitionKeyRecommendationSchema = z.object({
    /** One or two sentences summarizing the recommendation across all containers. */
    summary: z.string(),
    /** Per-container recommendation. */
    containers: z.array(ContainerRecommendationSchema),
});

export type PartitionKeyRecommendation = z.infer<typeof PartitionKeyRecommendationSchema>;
export type ContainerRecommendation = z.infer<typeof ContainerRecommendationSchema>;
export type PkCandidate = z.infer<typeof PkCandidateSchema>;
export type CandidateAssessment = z.infer<typeof CandidateAssessmentSchema>;
export type HotPartitionRisk = z.infer<typeof HotPartitionRiskSchema>;
export type QueryRouting = z.infer<typeof QueryRoutingSchema>;
export type QueryRoute = z.infer<typeof QueryRouteSchema>;
export type DocumentIdStrategy = z.infer<typeof DocumentIdStrategySchema>;

// ─── Data Modeling Event Discriminated Union ────────────────────────────────
// Async push events: the recommendation (or a failure) arrives after Copilot
// processes the request, so it cannot be returned from the request mutation.

export const DataModelingEventSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('recommendationReceived'),
        recommendation: PartitionKeyRecommendationSchema,
    }),
    z.object({
        type: z.literal('recommendationError'),
        message: z.string(),
    }),
]);

export type DataModelingEvent = z.infer<typeof DataModelingEventSchema>;

// ─── Data Modeling Events Router ────────────────────────────────────────────

export const dataModelingEventsRouterDef = dataModelingRouter({
    /**
     * Subscription that streams data-modeling events from the extension to the
     * webview. Yields typed discriminated-union payloads from a TypedEventSink.
     */
    events: dataModelingProcedure.subscription(async function* ({ ctx }) {
        const sink: TypedEventSink<DataModelingEvent> = ctx.eventSink;

        for await (const event of sink) {
            if (ctx.signal?.aborted) {
                return;
            }
            yield event;
        }
    }),
});
