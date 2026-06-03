/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic tRPC server-side telemetry middleware.
 *
 * The middleware itself does **not** talk to any telemetry backend. It
 * delegates the actual recording to a pluggable {@link TelemetryRunner}
 * supplied by the application:
 *
 *  - The framework chooses the **event id** (defaults to
 *    `"${type}.${path}"`, overridable via `buildEventId`).
 *  - The runner decides **how to record** the event and **what to enrich
 *    the procedure ctx with** for the rest of the pipeline.
 *
 * This keeps the framework dependency-free; the concrete adapter for
 * `@microsoft/vscode-azext-utils` lives in `azextTelemetryRunner.ts`
 * and is the only place that imports azext-utils.
 *
 * # Why a middleware (and not a `loggerLink`)?
 *
 * Telemetry needs access to the server-side `ctx` (and the ability to
 * mutate it, e.g. to surface an `actionContext` to procedures). Links
 * only see transport-level data. See `plans/webview-vs-documentdb-package.md`
 * section 2.3.
 *
 * # Why a body factory?
 *
 * `t.middleware(fn)` is bound to the instance's context type. Returning
 * a plain function lets the same factory plug into any tRPC instance:
 *
 * ```ts
 * const telemetryMW = queryEditorT.middleware(
 *     telemetryMiddlewareBody(azextTelemetryRunner, {
 *         buildEventId: ({ type, path }) => `cosmosDB.rpc.${type}.${path}`,
 *     }),
 * );
 * ```
 */

import { type MiddlewareResultLike, type ProcedureInvocation } from './types';

/**
 * Application-supplied recorder for a single procedure invocation.
 *
 * The runner is invoked once per call. Implementations should:
 *
 *  1. Open whatever telemetry scope they need (an `IActionContext`, an
 *     OpenTelemetry span, a plain `console.time`, …).
 *  2. Call `invoke(enrichment)` with whatever fields they want to push
 *     into the procedure's `ctx`. The framework merges those into the
 *     existing ctx via `next({ ctx: enrichment })`.
 *  3. Inspect the returned `MiddlewareResultLike` and report success or
 *     failure to the telemetry backend.
 *  4. Return the result back to the caller untouched so the rest of the
 *     middleware chain receives it.
 *
 * `TEnrichment` is the precise shape the runner contributes to ctx —
 * typically a record with one or two well-known keys (e.g.
 * `{ actionContext, telemetry }`). Procedures that need those fields
 * declare them on their concrete context type (see
 * `appRouter.CosmosDBRouterContext`).
 */
export interface TelemetryRunner<TEnrichment extends object> {
    run<TResult extends MiddlewareResultLike>(
        eventId: string,
        invocation: ProcedureInvocation,
        invoke: (enrichment: TEnrichment) => Promise<TResult>,
    ): Promise<TResult>;
}

export interface TelemetryMiddlewareOptions {
    /**
     * Build the telemetry event id from the invocation. Defaults to
     * `"${type}.${path}"`. Override to add a namespace prefix
     * (`cosmosDB.rpc.…`) or to apply per-call sampling rules.
     */
    buildEventId?: (invocation: ProcedureInvocation) => string;
}

/**
 * Build the body of a telemetry middleware bound to the given runner.
 *
 * Pass the returned function to `t.middleware(...)`. The runner's
 * `TEnrichment` type must be assignable to the tRPC instance's context
 * type — usually achieved by extending the per-app context interface
 * (see `CosmosDBRouterContext`).
 */
export function telemetryMiddlewareBody<TEnrichment extends object>(
    runner: TelemetryRunner<TEnrichment>,
    options: TelemetryMiddlewareOptions = {},
) {
    const buildEventId = options.buildEventId ?? defaultBuildEventId;

    return async <TResult>(opts: {
        path: string;
        type: ProcedureInvocation['type'];
        // Structural read so the runner can detect cancellation via
        // `invocation.signal?.aborted`. Optional — procedures that
        // intentionally run without a framework signal still type-check.
        ctx?: { signal?: AbortSignal };
        next: (override?: { ctx: TEnrichment }) => Promise<TResult>;
    }): Promise<TResult> => {
        const invocation: ProcedureInvocation = {
            path: opts.path,
            type: opts.type,
            signal: opts.ctx?.signal,
        };
        const eventId = buildEventId(invocation);

        let captured: TResult | undefined;
        await runner.run(eventId, invocation, async (enrichment) => {
            const result = await opts.next({ ctx: enrichment });
            captured = result;
            return result as unknown as MiddlewareResultLike;
        });
        // The runner guarantees `invoke` was called; if it threw, control
        // never reaches here. Cast back to the original branded type tRPC
        // expects from a middleware function.
        return captured as TResult;
    };
}

function defaultBuildEventId({ type, path }: ProcedureInvocation): string {
    return `${type}.${path}`;
}
