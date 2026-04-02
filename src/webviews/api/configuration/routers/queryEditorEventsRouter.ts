/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type TypedEventSink } from '../../../../utils/TypedEventSink';
import { publicProcedure, router, trpcToTelemetry } from '../../extension-server/trpc';
import { type QueryEditorRouterContext } from '../appRouter';
import { ModelInfoSchema } from '../schemas/aiSchemas';
import { PartitionKeyDefinitionSchema } from '../schemas/cosmosSchemas';
import { BulkDeleteResultSchema } from '../schemas/documentSchemas';
import { CosmosDBRecordIdentifierSchema, SerializedQueryResultSchema } from '../schemas/querySchemas';

// ─── Query Editor Event Discriminated Union ─────────────────────────────────

export const QueryEditorEventSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('fileOpened'),
        query: z.string(),
    }),
    z.object({
        type: z.literal('databaseConnected'),
        dbName: z.string(),
        containerName: z.string(),
        partitionKey: PartitionKeyDefinitionSchema.optional(),
    }),
    z.object({
        type: z.literal('databaseDisconnected'),
    }),
    z.object({
        type: z.literal('setConnectionList'),
        connectionList: z.record(z.string(), z.array(z.string())).optional(),
    }),
    z.object({
        type: z.literal('executionStarted'),
        executionId: z.string(),
        startTime: z.number(),
    }),
    z.object({
        type: z.literal('executionStopped'),
        executionId: z.string(),
        endTime: z.number(),
    }),
    z.object({
        type: z.literal('queryResults'),
        executionId: z.string(),
        result: SerializedQueryResultSchema.nullable(),
        currentPage: z.number(),
    }),
    z.object({
        type: z.literal('queryError'),
        executionId: z.string(),
        error: z.string(),
    }),
    z.object({
        type: z.literal('isSurveyCandidateChanged'),
        isSurveyCandidate: z.boolean(),
    }),
    z.object({
        type: z.literal('updateQueryHistory'),
        queryHistory: z.array(z.string()),
    }),
    z.object({
        type: z.literal('updateThroughputBuckets'),
        throughputBuckets: z.array(z.boolean()),
    }),
    z.object({
        type: z.literal('queryGenerated'),
        generatedQuery: z.union([z.string(), z.literal(false)]),
        modelName: z.string().optional(),
        prompt: z.string().optional(),
    }),
    z.object({
        type: z.literal('aiFeaturesEnabledChanged'),
        isEnabled: z.boolean(),
    }),
    z.object({
        type: z.literal('confirmToolInvocation'),
        message: z.string(),
    }),
    z.object({
        type: z.literal('selectedModelName'),
        modelName: z.string(),
    }),
    z.object({
        type: z.literal('availableModels'),
        models: z.array(ModelInfoSchema),
        savedModelId: z.string().nullable(),
    }),
    z.object({
        type: z.literal('documentDeleted'),
        documentId: CosmosDBRecordIdentifierSchema,
    }),
    z.object({
        type: z.literal('bulkDeleteComplete'),
        results: BulkDeleteResultSchema,
    }),
]);

export type QueryEditorEvent = z.infer<typeof QueryEditorEventSchema>;

// ─── Query Editor Events Router ─────────────────────────────────────────────

export const queryEditorEventsRouter = router({
    /**
     * Subscription that streams query editor events from the extension to the webview.
     * Yields typed discriminated-union payloads from a TypedEventSink.
     */
    events: publicProcedure.use(trpcToTelemetry).subscription(async function* ({ ctx }) {
        const myCtx = ctx as QueryEditorRouterContext;
        const sink: TypedEventSink<QueryEditorEvent> = myCtx.eventSink;

        for await (const event of sink) {
            if (myCtx.signal?.aborted) {
                return;
            }
            yield event;
        }
    }),
});
