/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type TypedEventSink } from '../../../utils/TypedEventSink';
import { migrationProcedure, migrationRouter } from '../trpc';

// ─── Migration Event Schema ─────────────────────────────────────────────────
// The migration feature uses a large, loosely-typed set of events with the
// shape { name, params } (mirroring the old Channel "event" payload). Each
// concrete event is validated by the webview when it dispatches based on
// `name`.

export const MigrationEventSchema = z.object({
    type: z.literal('event'),
    name: z.string(),
    params: z.array(z.unknown()),
});

export type MigrationEvent = z.infer<typeof MigrationEventSchema>;

// ─── Migration Events Router ────────────────────────────────────────────────

export const migrationEventsRouterDef = migrationRouter({
    /**
     * Subscription that streams migration events from the extension to the
     * webview. Yields { name, params } payloads from a TypedEventSink.
     */
    events: migrationProcedure.subscription(async function* ({ ctx }) {
        const sink: TypedEventSink<MigrationEvent> = ctx.eventSink;

        for await (const event of sink) {
            if (ctx.signal?.aborted) {
                return;
            }
            yield event;
        }
    }),
});
