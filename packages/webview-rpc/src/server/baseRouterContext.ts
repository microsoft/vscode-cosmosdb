/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Framework-level tRPC context types for the webview ↔ extension bridge.
 *
 * This file is intentionally generic and free of any application-specific
 * concerns. It declares the contract that `setupTrpc.ts` and the client
 * `vscodeLink.ts` rely on. Application code extends {@link BaseRouterContext}
 * with its own fields (database connections, webview identifiers, action
 * contexts, etc.).
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
 * object on the app-level context instead and leave this field unused.
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
 * Application code extends this type with its own fields.
 */
export interface BaseRouterContext {
    /**
     * Per-operation `AbortSignal` populated by `setupTrpc`. Procedures
     * can poll `signal.aborted` between yields or pass the signal to
     * cancellation-aware APIs (e.g. database drivers, fetch).
     */
    signal?: AbortSignal;

    /**
     * Telemetry context populated by the telemetry middleware (when used).
     * Optional — procedures that need it should null-check.
     *
     * For richer telemetry shapes extend this interface and add a typed
     * field on the app-level context type rather than widening this base
     * shape — keeps the framework layer dependency-free.
     */
    telemetry?: TelemetryContext;
}

/**
 * Type helper that takes any context shape with an **optional** field `K`
 * (typically `'telemetry'`, but anything you populate via middleware
 * works) and returns the same shape with that field made **required**.
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
 * Generic over the key name so applications can apply the same pattern
 * to their own enriched fields (e.g. an `actionContext` populated by a
 * custom telemetry runner) without inventing a separate helper.
 */
export type WithRequired<T extends Partial<Record<K, unknown>>, K extends PropertyKey> = T & {
    [P in K]-?: NonNullable<T[P]>;
};
