/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Framework-level tRPC context types for the webview ↔ extension bridge.
 *
 * This file is intentionally generic and free of any cosmosdb-specific
 * concerns (no `webviewName`, no `IActionContext`, no `vscode.WebviewPanel`).
 * It declares the contract that `setupTrpc.ts` and the client `vscodeLink.ts`
 * rely on. App-level fields belong in {@link ../appRouter.CosmosDBRouterContext}
 * (or any future per-app extension).
 *
 * Mirrors the public surface of `@microsoft/vscode-ext-react-webview` so
 * that — should we extract the framework layer into its own package — this
 * file becomes the package's `BaseRouterContext` module without changes.
 */

/**
 * Structural shape for telemetry data attached to a procedure invocation.
 *
 * Any object that exposes `properties: Record<string, string | undefined>`
 * and `measurements: Record<string, number | undefined>` satisfies this
 * contract. The optional value type accommodates telemetry libraries
 * that allow erased keys (e.g. `delete props['x']`) without forcing
 * consumers to widen to `unknown`.
 *
 * Kept minimal so the framework layer does not depend on any specific
 * telemetry library. Concrete telemetry middlewares may place a richer
 * object on the app-level context instead (e.g. cosmosdb's
 * `azextTelemetryRunner` exposes the full `IActionContext` via the
 * {@link ../appRouter.CosmosDBRouterContext.actionContext} field
 * rather than populating this field — `IActionContext.telemetry`
 * carries trusted-value markers we don't want to leak into the
 * framework's structural contract).
 */
export interface TelemetryContext {
    properties: Record<string, string | undefined>;
    measurements: Record<string, number | undefined>;
}

/**
 * Base router context shared by every tRPC procedure invocation.
 *
 * The framework populates {@link BaseRouterContext.signal} per-operation
 * (see `setupTrpc.ts`). {@link BaseRouterContext.telemetry} is populated
 * by user-supplied telemetry middleware when one is attached to the
 * procedure (optional — base-only callers may leave it `undefined`).
 *
 * Application code extends this type with its own fields (database
 * connections, webview identifiers, action contexts, etc.) — see
 * {@link ../appRouter.CosmosDBRouterContext}.
 */
export interface BaseRouterContext {
    /**
     * Per-operation `AbortSignal` populated by `setupTrpc`. Procedures
     * can poll `signal.aborted` between yields or pass the signal to
     * cancellation-aware APIs (e.g. the MongoDB driver).
     */
    signal?: AbortSignal;

    /**
     * Telemetry context populated by the telemetry middleware (when used).
     * Optional — procedures that need it should null-check.
     *
     * For richer telemetry shapes (e.g. `IActionContext` from azext-utils)
     * extend this interface and add a typed field on the app-level context
     * type rather than widening this base shape — keeps the framework
     * layer dependency-free.
     */
    telemetry?: TelemetryContext;
}

/**
 * Type helper that takes any context shape with an **optional** field `K`
 * (typically `'telemetry'` or, in cosmosdb, `'actionContext'`) and
 * returns the same shape with that field made **required**.
 *
 * Use it on procedure handlers that are mounted on a procedure-builder
 * with the corresponding middleware already applied — at that point you
 * *know* the field is present, and you want TypeScript to stop asking
 * you to null-check it in every line.
 *
 * ```ts
 * // BaseRouterContext.telemetry is optional in general, but every procedure
 * // mounted on `publicProcedureWithTelemetry` is guaranteed to receive it.
 * publicProcedureWithTelemetry.query(({ ctx }: { ctx: WithRequired<MyCtx, 'telemetry'> }) => {
 *     ctx.telemetry.properties.foo = 'bar';  // no null-check needed
 * });
 * ```
 *
 * Cosmosdb uses this with `'actionContext'` on `CosmosDBRouterContext`
 * (see `appRouter.ts`) — every procedure built on `queryEditorProcedure`
 * etc. gets `ctx.actionContext` populated by the azext runner.
 *
 * Mirrors documentdb's `WithTelemetry<T>` helper but is generic over
 * the key name so cosmosdb can apply the same pattern to its richer
 * `actionContext` field without inventing a separate helper.
 */
export type WithRequired<T extends Partial<Record<K, unknown>>, K extends PropertyKey> = T & {
    [P in K]-?: NonNullable<T[P]>;
};

/**
 * Convenience alias for the most common cosmosdb case: assert that
 * `actionContext` is non-optional on a procedure that runs through the
 * `azextTelemetryRunner` middleware.
 *
 * Equivalent to `WithRequired<T, 'actionContext'>`, but reads naturally
 * at the call site:
 *
 * ```ts
 * .query(({ ctx }: { ctx: WithActionContext<QueryEditorRouterContext> }) => {
 *     ctx.actionContext.telemetry.suppressIfSuccessful = true;  // no `?.`
 * });
 * ```
 */
export type WithActionContext<T extends { actionContext?: unknown }> = WithRequired<T, 'actionContext'>;
