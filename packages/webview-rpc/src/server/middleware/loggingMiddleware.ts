/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic tRPC server-side logging middleware.
 *
 * Wraps every procedure call and reports start/end (with duration and
 * outcome) to a pluggable {@link ProcedureLogger}. The middleware itself
 * is dependency-free — concrete loggers (console, output channel, …) are
 * provided by the application.
 *
 * # Why a middleware (and not a client-side `loggerLink`)?
 *
 * `loggerLink()` from `@trpc/client` only sees what the client sends and
 * receives — it has no access to the server-side `ctx` and cannot honour
 * per-call opt-outs the way a middleware can.
 *
 * # Why a body factory (not bound to a specific tRPC instance)?
 *
 * `t.middleware(fn)` is bound to the instance's context type, but the
 * logger doesn't care about ctx. By returning a plain function we make
 * the body reusable across every tRPC instance the consumer creates:
 *
 * ```ts
 * const mw = appT.middleware(loggingMiddlewareBody(consoleProcedureLogger));
 * ```
 */

import { type MiddlewareResultLike, type ProcedureInvocation } from './types';

/**
 * Sink invoked by the logging middleware for each procedure call.
 *
 * Implementations should be **non-throwing and fast** — the middleware
 * already swallows thrown errors as a safety net, but slow loggers will
 * extend perceived RPC latency.
 *
 * Both hooks are optional so consumers can subscribe only to what they
 * need (e.g. log only completions and skip start events).
 */
export interface ProcedureLogger {
    /** Called immediately before the procedure body runs. */
    onStart?(info: ProcedureInvocation): void;

    /** Called when the procedure completes (success or error). */
    onEnd?(
        info: ProcedureInvocation & {
            /** Wall-clock duration of the procedure body, in milliseconds. */
            durationMs: number;
            /** `true` if the middleware result was `{ ok: true }`. */
            ok: boolean;
            /**
             * `true` if `info.signal?.aborted` is set when the call ends.
             * Convenience flag so loggers can distinguish a clean error
             * from a client-side cancellation without re-reading the
             * signal themselves.
             */
            aborted: boolean;
            /** The propagated error when `ok === false`. */
            error?: Error;
        },
    ): void;
}

/**
 * Default logger that writes a single line per completion to the dev
 * console. Suitable as a fallback when no application-specific sink is
 * available; production code should provide a richer logger (e.g.
 * `vscode.LogOutputChannel`-backed).
 */
export const consoleProcedureLogger: ProcedureLogger = {
    onEnd({ path, type, durationMs, ok, aborted, error }) {
        const head = `[trpc] ${type} ${path} ${durationMs.toFixed(1)}ms`;
        if (aborted) {
            console.debug(`${head} canceled`);
        } else if (ok) {
            console.debug(`${head} ok`);
        } else {
            console.warn(`${head} error: ${error?.message ?? '(unknown)'}`);
        }
    },
};

/**
 * Build the body of a logging middleware.
 *
 * Pass the returned function to `t.middleware(...)`:
 *
 * ```ts
 * const loggingMW = queryEditorT.middleware(
 *     loggingMiddlewareBody(consoleProcedureLogger),
 * );
 * export const queryEditorProcedure = queryEditorT.procedure.use(loggingMW);
 * ```
 *
 * Accepts either a logger instance or a factory function — the latter
 * is useful when the logger is created lazily (e.g. after extension
 * activation) or per-invocation.
 */
export function loggingMiddlewareBody(loggerOrFactory: ProcedureLogger | (() => ProcedureLogger)) {
    const resolveLogger = typeof loggerOrFactory === 'function' ? loggerOrFactory : () => loggerOrFactory;

    return async <TResult>(opts: {
        path: string;
        type: ProcedureInvocation['type'];
        // Structural read: any framework-populated `ctx.signal` is surfaced
        // to logger sinks via `ProcedureInvocation.signal`. Optional so a
        // procedure that bypasses the framework signal still type-checks.
        ctx?: { signal?: AbortSignal };
        next: (...args: unknown[]) => Promise<TResult>;
    }): Promise<TResult> => {
        const invocation: ProcedureInvocation = {
            path: opts.path,
            type: opts.type,
            signal: opts.ctx?.signal,
        };

        const logger = resolveLogger();
        safeInvoke(() => logger.onStart?.(invocation));

        const start = Date.now();
        const result = await opts.next();
        const durationMs = Date.now() - start;

        const inspect = result as unknown as MiddlewareResultLike;
        safeInvoke(() =>
            logger.onEnd?.({
                ...invocation,
                durationMs,
                ok: inspect.ok,
                aborted: invocation.signal?.aborted ?? false,
                error: inspect.ok ? undefined : inspect.error,
            }),
        );

        return result;
    };
}

function safeInvoke(fn: () => void): void {
    try {
        fn();
    } catch {
        // Never let logging side-effects break a procedure.
    }
}
