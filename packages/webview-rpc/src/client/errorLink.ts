/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TRPCClientError, type TRPCLink } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { type RpcEventEmitter } from './events';

/**
 * tRPC link that observes the outcome of each query / mutation and
 * republishes it through an {@link RpcEventEmitter} channel, so any
 * number of subscribers can react to successes, errors, and caller
 * aborts from one central place.
 *
 * Behaviour:
 *
 * - **Subscriptions** are passed through untouched. They have their
 *   own per-call `.subscribe({ onData, onError, onComplete })` API and
 *   routing them through the channel would surface every streamed
 *   error twice.
 * - **Successes** publish `{ result.data }` to the channel. The
 *   downstream `next` is always called so the call-site promise
 *   resolves normally — the link is observer-only.
 * - **Errors** that match the client-side `AbortError` shape are
 *   routed to `emitAborted` and **never** to `emitError`. Other errors
 *   are routed to `emitError`. In both cases the error is re-emitted
 *   downstream so the call-site `.catch(...)` still fires — the link
 *   never swallows.
 *
 * @example
 * ```ts
 * const events = createEventChannel();
 * const client = createTRPCClient<Router>({
 *     links: [loggerLink(), errorLink<Router>(events), vscodeLink<Router>({ send, onReceive })],
 * });
 * events.onError((err, info) => toaster.error(`${info.path}: ${err.message}`));
 * ```
 */
export function errorLink<TRouter extends AnyRouter>(events: RpcEventEmitter): TRPCLink<TRouter> {
    return () => {
        return ({ next, op }) => {
            return observable((observer) => {
                return next(op).subscribe({
                    next(value) {
                        // Subscriptions emit many values and complete differently;
                        // treat only one-shot queries/mutations as "succeeded".
                        if (op.type !== 'subscription') {
                            // tRPC v11 envelope shape: { result: { data: T } } for
                            // a settled query/mutation. Defensive read so a
                            // shape-mismatched link upstream still degrades to
                            // `undefined` data instead of crashing the pipeline.
                            const data = (value as { result?: { data?: unknown } })?.result?.data;
                            events.emitSuccess({ type: op.type, path: op.path }, data);
                        }
                        observer.next(value);
                    },
                    error(err: unknown) {
                        if (op.type !== 'subscription') {
                            if (isAbortError(err)) {
                                // Client-initiated cancellation — never reach
                                // onError; surface to onAborted (if anyone is
                                // subscribed) and otherwise drop silently.
                                events.emitAborted({ type: op.type, path: op.path });
                            } else {
                                const error = err instanceof Error ? err : new Error(String(err));
                                events.emitError(error, { type: op.type, path: op.path });
                            }
                        }
                        // Always re-emit so call-site `.catch(...)` handlers still fire.
                        observer.error(err as TRPCClientError<TRouter>);
                    },
                    complete() {
                        observer.complete();
                    },
                });
            });
        };
    };
}

/**
 * Heuristic for client-initiated `AbortSignal` cancellation. Matches
 * the standard `DOMException('…', 'AbortError')` shape on both the
 * error itself and its `cause` chain (tRPC wraps the original in a
 * `TRPCClientError`).
 */
function isAbortError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    if ((err as { name?: string }).name === 'AbortError') return true;
    const cause = (err as { cause?: { name?: string } }).cause;
    return cause?.name === 'AbortError';
}
