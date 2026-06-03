/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Framework-level types shared by middleware factories under this folder.
 *
 * Intentionally framework-only: no application-specific concerns and no
 * dependency on any concrete telemetry / logging library.
 */

/** The three tRPC procedure flavors. */
export type ProcedureType = 'query' | 'mutation' | 'subscription';

/**
 * Lightweight description of a single procedure invocation, passed to
 * logger / telemetry hooks. Independent of any tRPC internal type so
 * tests and consumers can build it by hand.
 */
export interface ProcedureInvocation {
    path: string;
    type: ProcedureType;

    /**
     * Per-operation `AbortSignal` lifted from `ctx.signal` (when the
     * framework populated it — see `BaseRouterContext.signal`). Optional
     * because (a) some procedures intentionally run without one, and
     * (b) the structural read in middleware bodies is tolerant of a
     * missing field.
     *
     * Read it from your runner / logger to distinguish a clean error
     * from a client-side cancellation:
     *
     * ```ts
     * if (invocation.signal?.aborted) {
     *     telemetry.properties.result = 'Canceled';
     * }
     * ```
     */
    signal?: AbortSignal;
}

/**
 * Structural minimum of a tRPC `MiddlewareResult`. Sufficient to
 * differentiate success from failure and to read the error in the
 * failure case, without importing internal tRPC types.
 */
export interface MiddlewareResultLike {
    ok: boolean;
    error?: Error & { cause?: unknown };
}
