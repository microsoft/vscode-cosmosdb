/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cosmosdb-specific {@link TelemetryRunner} implementation backed by
 * `@microsoft/vscode-azext-utils`'s `callWithTelemetryAndErrorHandling`.
 *
 * This is the **only** place in the trpc layer that imports azext-utils.
 * The framework-level `telemetryMiddlewareBody` calls into this runner
 * and stays dependency-free, so the rest of `src/panels/trpc/` could be
 * lifted into a shared package without dragging azext-utils along
 * (see `plans/webview-vs-documentdb-package.md`).
 *
 * The runner contributes a single field to the procedure ctx:
 *
 *  - `actionContext` — the full `IActionContext` (for procedures that
 *    need azext-utils features like `errorHandling.suppressDisplay`,
 *    `telemetry.suppressIfSuccessful`, or to write structured
 *    `properties`/`measurements` via `actionContext.telemetry`).
 *
 * We intentionally do **not** populate `BaseRouterContext.telemetry`:
 * `IActionContext.telemetry` carries `TelemetryTrustedValue` markers
 * that are not part of the framework's structural `TelemetryContext`
 * contract. Procedures that want plain `properties`/`measurements`
 * read them from `ctx.actionContext.telemetry`.
 */

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type TelemetryRunner } from './telemetryMiddleware';
import { type ProcedureInvocation } from './types';

/**
 * Shape this runner injects into the procedure ctx. Application context
 * types extend `BaseRouterContext` with this field so procedures can
 * read `ctx.actionContext` without casts (see `CosmosDBRouterContext`).
 */
export interface AzextTelemetryEnrichment {
    actionContext: IActionContext;
}

/**
 * The cosmosdb runner. Wraps each invocation in
 * `callWithTelemetryAndErrorHandling` and forwards errors raised by the
 * procedure to azext-utils telemetry without displaying them as toasts
 * (each webview surfaces its own error UI).
 *
 * **Cancellation accounting.** Reads `invocation.signal?.aborted` after
 * the call completes; when set, the call is reported with
 * `result=Canceled` and `aborted=true` instead of `result=Failed`. This
 * lets dashboards distinguish genuine errors from user-driven cancels
 * (panel closed mid-query, user hit "Stop", etc.) so cancellation rate
 * does not pollute the error budget.
 */
export const azextTelemetryRunner: TelemetryRunner<AzextTelemetryEnrichment> = {
    async run(eventId, invocation: ProcedureInvocation, invoke) {
        const result = await callWithTelemetryAndErrorHandling(eventId, async (actionContext) => {
            actionContext.errorHandling.suppressDisplay = true;

            const middlewareResult = await invoke({ actionContext });

            const aborted = invocation.signal?.aborted ?? false;
            if (aborted) {
                actionContext.telemetry.properties.aborted = 'true';
                actionContext.telemetry.properties.result = 'Canceled';
            }

            if (!middlewareResult.ok && middlewareResult.error) {
                const error = middlewareResult.error;
                // Do not overwrite the canceled-result marker — a procedure
                // that observed `ctx.signal.aborted` and threw should still
                // count as a cancellation, not a failure.
                if (!aborted) {
                    actionContext.telemetry.properties.result = 'Failed';
                }
                actionContext.telemetry.properties.error = error.name;
                actionContext.telemetry.properties.errorMessage = error.message;
                actionContext.telemetry.properties.errorStack = error.stack ?? '';
                if (error.cause) {
                    actionContext.telemetry.properties.errorCause = JSON.stringify(error.cause, null, 0);
                }
            }

            return middlewareResult;
        });

        if (!result) {
            throw new Error(`No result returned from tRPC telemetry wrapper for ${eventId}`);
        }

        return result;
    },
};
