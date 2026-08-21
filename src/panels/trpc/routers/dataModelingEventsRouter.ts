/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TypedEventSink } from '@cosmosdb/webview-rpc';
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

export const ContainerRecommendationSchema = z.object({
    /** Name of the container this recommendation applies to. */
    entity: z.string(),
    /** Recommended partition-key path, e.g. `/customerId` or a hierarchical `/tenantId, /userId`. */
    partitionKey: z.string(),
    /** Why this key is recommended (short markdown/plain text). */
    rationale: z.string(),
    /** Viable alternatives with a short note each. */
    alternatives: z.array(CandidateNoteSchema).optional(),
    /** Keys to avoid with the reason each is a poor fit. */
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
