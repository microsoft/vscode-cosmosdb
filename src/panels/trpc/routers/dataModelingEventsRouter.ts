/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TypedEventSink } from '@microsoft/vscode-ext-webview';
import { z } from 'zod';
import { PartitionKeyRecommendationSchema } from '../../../dataModeling/recommendationSchema';
import { dataModelingProcedure, dataModelingRouter } from '../trpc';

export * from '../../../dataModeling/recommendationSchema';

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

export const dataModelingEventsRouterDef = dataModelingRouter({
    /** Streams recommendations from the extension to the originating wizard. */
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
