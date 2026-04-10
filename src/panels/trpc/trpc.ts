/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * tRPC instance configuration.
 *
 * Each webview type (Query Editor, Document) gets its own tRPC instance with a
 * properly typed context. This eliminates the need for middleware-based context
 * casting (`next({ ctx: ctx as T })`) and avoids the shallow-copy problem that
 * such middleware introduces.
 *
 * @see https://trpc.io/docs/v11/router
 * @see https://trpc.io/docs/v11/procedures
 */

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { initTRPC, type TRPCError } from '@trpc/server';
import { type DocumentRouterContext, type QueryEditorRouterContext } from './appRouter';

// ─── Query Editor tRPC Instance ─────────────────────────────────────────────
// Context is QueryEditorRouterContext — all procedures get properly typed ctx.

const queryEditorT = initTRPC.context<QueryEditorRouterContext>().create();

const queryEditorTrpcToTelemetry = queryEditorT.middleware(async ({ path, type, next }) => {
    return telemetryMiddlewareImpl(`cosmosDB.rpc.${type}.${path}`, (actionContext) => next({ ctx: { actionContext } }));
});

/** Base procedure with telemetry middleware already applied. */
export const queryEditorProcedure = queryEditorT.procedure.use(queryEditorTrpcToTelemetry);
export const queryEditorRouter = queryEditorT.router;
export const queryEditorMergeRouters = queryEditorT.mergeRouters;
export const queryEditorCallerFactory = queryEditorT.createCallerFactory;

// ─── Document tRPC Instance ─────────────────────────────────────────────────
// Context is DocumentRouterContext — all procedures get properly typed ctx.

const documentT = initTRPC.context<DocumentRouterContext>().create();

const documentTrpcToTelemetry = documentT.middleware(async ({ path, type, next }) => {
    return telemetryMiddlewareImpl(`cosmosDB.rpc.${type}.${path}`, (actionContext) => next({ ctx: { actionContext } }));
});

/** Base procedure with telemetry middleware already applied. */
export const documentProcedure = documentT.procedure.use(documentTrpcToTelemetry);
export const documentRouter = documentT.router;
export const documentCallerFactory = documentT.createCallerFactory;

// ─── Shared Telemetry Implementation ────────────────────────────────────────

/**
 * Type guard for tRPC middleware error results.
 * Avoids importing internal types from `@trpc/server/unstable-core-do-not-import`.
 */
function isMiddlewareError(result: { ok: boolean }): result is { ok: false; error: TRPCError } {
    return !result.ok;
}

/**
 * Shared telemetry middleware logic. Wraps procedure execution in
 * `callWithTelemetryAndErrorHandling` and logs errors without displaying them.
 *
 * Each tRPC instance creates its own middleware using this helper because
 * `t.middleware()` is bound to the instance's context type.
 *
 * The function is generic over the exact result type returned by `next()`,
 * so the branded `MiddlewareResult` flows through without needing to
 * import internal tRPC types.
 */
async function telemetryMiddlewareImpl<TResult extends { ok: boolean }>(
    telemetryId: string,
    next: (actionContext: IActionContext) => Promise<TResult>,
): Promise<TResult> {
    const result = await callWithTelemetryAndErrorHandling(telemetryId, async (actionContext) => {
        actionContext.errorHandling.suppressDisplay = true;

        const result = await next(actionContext);

        if (isMiddlewareError(result)) {
            actionContext.telemetry.properties.result = 'Failed';
            actionContext.telemetry.properties.error = result.error.name;
            actionContext.telemetry.properties.errorMessage = result.error.message;
            actionContext.telemetry.properties.errorStack = result.error.stack ?? '';
            if (result.error.cause) {
                actionContext.telemetry.properties.errorCause = JSON.stringify(result.error.cause, null, 0);
            }
        }

        return result;
    });

    if (!result) {
        throw new Error(`No result returned from tRPC telemetry wrapper for ${telemetryId}`);
    }

    return result;
}
