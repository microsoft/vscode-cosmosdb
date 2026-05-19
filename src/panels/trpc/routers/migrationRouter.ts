/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { migrationProcedure, migrationRouter } from '../trpc';

// ─── Migration Router ───────────────────────────────────────────────────────
// All migration commands are dispatched through a single generic procedure
// that forwards to the MigrationAssistantTab's command dispatcher. This mirrors
// the old Channel-based getCommand(payload) pattern but goes through tRPC.
//
// The webview invokes `migration.command.mutate({ commandName, params })`
// instead of the old `channel.postMessage({ type: 'request', name, params })`.

export const migrationRouterDef = migrationRouter({
    command: migrationProcedure
        .input(
            z.object({
                commandName: z.string(),
                params: z.array(z.unknown()).default([]),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            return ctx.dispatchCommand(input.commandName, input.params);
        }),
});
