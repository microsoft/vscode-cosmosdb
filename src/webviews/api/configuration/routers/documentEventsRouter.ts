/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type TypedEventSink } from '../../../../utils/TypedEventSink';
import { publicProcedure, router, trpcToTelemetry } from '../../extension-server/trpc';
import { type DocumentRouterContext } from '../appRouter';
import { PartitionKeyDefinitionSchema, PartitionKeySchema } from '../schemas/cosmosSchemas';
import { OpenDocumentModeSchema } from '../schemas/documentSchemas';
import { CosmosDBRecordSchema } from '../schemas/querySchemas';

// ─── Document Event Discriminated Union ─────────────────────────────────────

export const DocumentEventSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('initState'),
        mode: OpenDocumentModeSchema,
        databaseId: z.string(),
        containerId: z.string(),
        documentId: z.string(),
        partitionKey: PartitionKeySchema.optional(),
    }),
    z.object({
        type: z.literal('modeChanged'),
        mode: OpenDocumentModeSchema,
    }),
    z.object({
        type: z.literal('setDocument'),
        sessionId: z.string(),
        documentContent: CosmosDBRecordSchema,
        partitionKey: PartitionKeyDefinitionSchema.optional(),
    }),
    z.object({
        type: z.literal('documentSaved'),
    }),
    z.object({
        type: z.literal('documentError'),
        sessionId: z.string(),
        error: z.string(),
    }),
    z.object({
        type: z.literal('queryError'),
        sessionId: z.string(),
        error: z.string(),
    }),
    z.object({
        type: z.literal('operationAborted'),
        sessionId: z.string().optional(),
        message: z.string().optional(),
    }),
]);

export type DocumentEvent = z.infer<typeof DocumentEventSchema>;

// ─── Document Events Router ─────────────────────────────────────────────────

export const documentEventsRouter = router({
    /**
     * Subscription that streams document events from the extension to the webview.
     * Yields typed discriminated-union payloads from a TypedEventSink.
     */
    events: publicProcedure.use(trpcToTelemetry).subscription(async function* ({ ctx }) {
        const myCtx = ctx as DocumentRouterContext;
        const sink: TypedEventSink<DocumentEvent> = myCtx.eventSink;

        for await (const event of sink) {
            if (myCtx.signal?.aborted) {
                return;
            }
            yield event;
        }
    }),
});
