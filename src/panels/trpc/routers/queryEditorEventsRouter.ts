/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type TypedEventSink } from '../../../utils/TypedEventSink';
import { queryEditorProcedure, queryEditorRouter } from '../trpc';

// ─── Query Editor Event Discriminated Union ─────────────────────────────────
// Only truly async push events remain here — events that originate from
// background operations (QuerySession execution, LLM generation) and cannot
// be returned as mutation/query responses.

export const QueryEditorEventSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('confirmToolInvocation'),
        message: z.string(),
    }),
    z.object({
        type: z.literal('aiFeaturesEnabledChanged'),
        isEnabled: z.boolean(),
    }),
    z.object({
        type: z.literal('queryTextPushed'),
        query: z.string(),
    }),
    z.object({
        type: z.literal('isSurveyCandidateChanged'),
        isSurveyCandidate: z.boolean(),
    }),
    z.object({
        type: z.literal('schemaSettingChanged'),
        isSchemaBasedOnQueries: z.boolean(),
    }),
    z.object({
        type: z.literal('schemaUpdated'),
        containerSchema: z.record(z.string(), z.unknown()).nullable(),
    }),
]);

export type QueryEditorEvent = z.infer<typeof QueryEditorEventSchema>;

// ─── Query Editor Events Router ─────────────────────────────────────────────

export const queryEditorEventsRouterDef = queryEditorRouter({
    /**
     * Subscription that streams query editor events from the extension to the webview.
     * Yields typed discriminated-union payloads from a TypedEventSink.
     */
    events: queryEditorProcedure.subscription(async function* ({ ctx }) {
        const sink: TypedEventSink<QueryEditorEvent> = ctx.eventSink;

        for await (const event of sink) {
            if (ctx.signal?.aborted) {
                return;
            }
            yield event;
        }
    }),
});
