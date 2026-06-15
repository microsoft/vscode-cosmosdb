/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cross-cutting observability channel for a single tRPC client instance.
 *
 * The channel is the *only* sanctioned extension point for observing
 * outcomes of queries and mutations from outside the call site:
 * centralised toasts, ARIA announcements, telemetry, status-bar
 * indicators, cancellation logs, and so on. Each subscriber sees every
 * event for as long as it stays subscribed.
 *
 * The channel is intentionally **observer-only** — handlers cannot
 * mutate the response value or convert an error into a success. If you
 * need true interceptor behaviour (retry / fallback / payload rewrite),
 * write a dedicated `TRPCLink` and add it to the client's `links`
 * array; that is the native tRPC extension point and we deliberately do
 * not duplicate it.
 *
 * Subscriptions are **not** routed through this channel. They have
 * their own per-call `.subscribe({ onData, onError, onComplete })`
 * hooks; double-reporting them centrally would surface every streamed
 * error twice. Only `query` and `mutation` operations are observed.
 */

/**
 * Metadata about the procedure call that triggered a lifecycle event.
 * The `type` field is narrowed to `query | mutation` because
 * subscriptions are filtered out before the event is published.
 */
export interface CallInfo {
    type: 'query' | 'mutation';
    path: string;
}

/**
 * Handler invoked when a query or mutation resolves successfully.
 *
 * `data` is the resolved value the call site would receive from
 * `await client.foo.query()`. It is typed as `unknown` because a single
 * central handler typically routes by `info.path` rather than knowing
 * the per-procedure result type at the subscription site.
 */
export type SuccessHandler = (info: CallInfo, data: unknown) => void;

/**
 * Handler invoked when a query or mutation rejects with a non-abort
 * error. Caller-initiated cancellations are routed to
 * {@link AbortedHandler} instead — see {@link RpcEventChannel.onAborted}.
 */
export type ErrorHandler = (error: Error, info: CallInfo) => void;

/**
 * Handler invoked when a query or mutation was canceled via the
 * `AbortSignal` the caller passed to it. Exists so consumers can react
 * to user-initiated cancellations (e.g. a "Run Query" → "Cancel" flow)
 * without dressing up an abort as an error in a central toast.
 *
 * If nobody subscribes to `onAborted`, aborts are silently dropped at
 * the channel — the call site that triggered the cancellation already
 * knows the outcome via its own `.catch(...)`.
 */
export type AbortedHandler = (info: CallInfo) => void;

/**
 * Function returned by every `on*` subscriber. Call it to detach the
 * handler. Idempotent — calling it twice is safe and is a no-op the
 * second time.
 */
export type Unsubscribe = () => void;

/**
 * Public surface of the per-client event channel. Returned alongside
 * the tRPC client from `useTrpcClient` (and from the equivalent
 * vanilla-client factory).
 *
 * @example
 * ```ts
 * const { trpcClient, events } = useTrpcClient<AppRouter>();
 *
 * useEffect(() => {
 *     const offError = events.onError((err, info) => toaster.error(`${info.path}: ${err.message}`));
 *     const offOk    = events.onSuccess((info)    => statusBar.flash(`✔ ${info.path}`));
 *     const offAbort = events.onAborted((info)    => log.debug(`canceled: ${info.path}`));
 *     return () => { offError(); offOk(); offAbort(); };
 * }, [events]);
 * ```
 */
export interface RpcEventChannel {
    /** Subscribe to successful query/mutation completions. */
    onSuccess(handler: SuccessHandler): Unsubscribe;
    /** Subscribe to non-abort query/mutation errors. */
    onError(handler: ErrorHandler): Unsubscribe;
    /** Subscribe to caller-initiated query/mutation aborts. */
    onAborted(handler: AbortedHandler): Unsubscribe;
}

/**
 * Internal-but-exposed surface used by `errorLink` to publish events
 * into the channel. Kept separate from {@link RpcEventChannel} so the
 * subscription API stays read-only from the consumer's perspective.
 *
 * Each `emit*` method iterates a snapshot of the handler set so that a
 * handler unsubscribing itself (or subscribing a new one) during
 * dispatch does not perturb the current iteration. Exceptions thrown
 * from a handler are reported via `console.error` and never propagate —
 * one buggy subscriber must not break the rest of the pipeline.
 */
export interface RpcEventEmitter extends RpcEventChannel {
    emitSuccess(info: CallInfo, data: unknown): void;
    emitError(error: Error, info: CallInfo): void;
    emitAborted(info: CallInfo): void;
}

/**
 * Build a fresh pub-sub channel for a single tRPC client.
 *
 * The channel is intentionally tiny — three `Set`s of handlers and a
 * uniform `dispatch` helper that swallows handler exceptions so that
 * one broken subscriber can't take down the rest of the pipeline.
 *
 * Subscribe functions return an idempotent `Unsubscribe`. Snapshots
 * (`[...set]`) are taken before dispatch so a handler can safely
 * subscribe / unsubscribe during the call without disturbing the
 * in-flight iteration.
 */
export function createEventChannel(): RpcEventEmitter {
    const successHandlers = new Set<SuccessHandler>();
    const errorHandlers = new Set<ErrorHandler>();
    const abortedHandlers = new Set<AbortedHandler>();

    function dispatch<T extends (...args: never[]) => void>(handlers: Set<T>, invoke: (handler: T) => void): void {
        // Snapshot first so subscribe/unsubscribe inside a handler is safe —
        // `Array.from` (not `[...handlers]`) keeps `no-useless-spread` happy.
        const snapshot = Array.from(handlers);
        for (const handler of snapshot) {
            try {
                invoke(handler);
            } catch (err) {
                // A broken subscriber must not break siblings or the link chain.
                // oxlint-disable-next-line no-console
                console.error('[webview-rpc] event handler threw', err);
            }
        }
    }

    return {
        onSuccess(handler) {
            successHandlers.add(handler);
            return () => {
                successHandlers.delete(handler);
            };
        },
        onError(handler) {
            errorHandlers.add(handler);
            return () => {
                errorHandlers.delete(handler);
            };
        },
        onAborted(handler) {
            abortedHandlers.add(handler);
            return () => {
                abortedHandlers.delete(handler);
            };
        },
        emitSuccess(info, data) {
            dispatch(successHandlers, (h) => h(info, data));
        },
        emitError(error, info) {
            dispatch(errorHandlers, (h) => h(error, info));
        },
        emitAborted(info) {
            dispatch(abortedHandlers, (h) => h(info));
        },
    };
}
