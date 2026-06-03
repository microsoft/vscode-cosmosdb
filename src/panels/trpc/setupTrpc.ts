/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getTRPCErrorFromUnknown, type AnyRouter } from '@trpc/server';
import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { type BaseRouterContext } from './baseRouterContext';
import { type VsCodeLinkRequestMessage } from './vscodeProtocol';

/**
 * Converts an unknown error into a tRPC-compatible error response.
 */
function wrapInTrpcErrorMessage(error: unknown, operationId: string) {
    const errorEntry = getTRPCErrorFromUnknown(error);

    return {
        id: operationId,
        error: {
            code: errorEntry.code,
            name: errorEntry.name,
            message: errorEntry.message,
            stack: errorEntry.stack,
            cause: errorEntry.cause,
        },
    };
}

/**
 * Safely posts a message to the webview panel.
 *
 * `vscode.Webview.postMessage` may either throw synchronously or return a
 * `Thenable` that rejects when the panel has been disposed. We guard both
 * so that natural races (e.g. a subscription generator yielding one more
 * value after the user closed the tab) do not surface as uncaught
 * exceptions in the extension host.
 *
 * Returns `false` if the message could not be delivered; `true` otherwise.
 * The boolean is informational — callers do not need to react.
 */
function safePostMessage(panel: vscode.WebviewPanel, message: unknown): boolean {
    try {
        // The Thenable returned by `postMessage` resolves with a delivery boolean
        // and rejects if the webview is already gone. Attach a no-op catch so a
        // late rejection does not surface as an unhandled promise rejection.
        void Promise.resolve(panel.webview.postMessage(message)).catch(() => void 0);
        return true;
    } catch {
        // Panel was disposed between our check and the actual call
        return false;
    }
}

/**
 * Normalizes a procedure's subscription return value (which may be an
 * `AsyncIterable`, an `AsyncIterator`, or both — async generators are
 * both) to a single live `AsyncIterator`.
 *
 * Calling `[Symbol.asyncIterator]()` once is required for iterables like
 * {@link import('../../utils/TypedEventSink').TypedEventSink} which
 * enforce single-consumer semantics; direct iterators are returned as-is.
 */
function toAsyncIterator(value: unknown): AsyncIterator<unknown> {
    if (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
    ) {
        return (value as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    }
    return value as AsyncIterator<unknown>;
}

/**
 * Tracks a live subscription so we can both signal cooperative cancellation
 * (via `abortController.abort()`) and release a consumer parked on the next
 * `iterator.next()` (via `iterator.return()`). The abort signal alone cannot
 * unblock a parked `next()`; the iterator-protocol `return()` is what
 * propagates through the procedure's inner `for await` over an event sink.
 */
interface ActiveSubscription {
    abortController: AbortController;
    iterator: AsyncIterator<unknown>;
}

/**
 * Sets up tRPC integration for a webview panel.
 *
 * Each webview type (QueryEditor, Document) has its own tRPC instance with a
 * properly typed context. The caller passes the specific `appRouter` and
 * `createCallerFactory` from that instance.
 *
 * @param panel - The VS Code webview panel to attach the message listener to.
 * @param context - The router context passed to every procedure invocation.
 *   Cloned per-operation before `signal` is attached, so the shared object is
 *   never mutated and concurrent operations do not stomp on each other.
 * @param appRouter - The tRPC router for this webview type.
 * @param createCallerFactory - The `createCallerFactory` function from the
 *   tRPC instance that created `appRouter`.
 */
export function setupTrpc<TContext extends BaseRouterContext, TRouter extends AnyRouter>(
    panel: vscode.WebviewPanel,
    context: TContext,
    appRouter: TRouter,
    createCallerFactory: (router: TRouter) => (ctx: TContext) => Record<string, unknown>,
): {
    disposable: vscode.Disposable;
    activeSubscriptions: Map<string, ActiveSubscription>;
    activeOperations: Map<string, AbortController>;
} {
    const activeSubscriptions = new Map<string, ActiveSubscription>();
    const activeOperations = new Map<string, AbortController>();

    const disposable = panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
        // Guard against non-tRPC messages reaching this listener (e.g. legacy
        // channel-protocol payloads from a webview that wasn't fully migrated,
        // or dev-server signals). Log them at warn level so missed migrations
        // surface during development instead of being silently dropped.
        if (!message || typeof message !== 'object' || !message.op || typeof message.op.type !== 'string') {
            console.warn(
                '[setupTrpc] Ignoring non-tRPC message on webview channel. ' +
                    'If this originates from our own webview code, it likely needs to be migrated to tRPC. Payload:',
                JSON.stringify(message),
            );
            return;
        }
        switch (message.op.type) {
            case 'subscription':
                await handleSubscriptionMessage(
                    panel,
                    message,
                    context,
                    activeSubscriptions,
                    appRouter,
                    createCallerFactory,
                );
                break;

            case 'subscription.stop':
                handleSubscriptionStopMessage(message, activeSubscriptions);
                break;

            case 'abort':
                handleAbortMessage(message, activeOperations);
                break;

            default:
                await handleDefaultMessage(panel, message, context, activeOperations, appRouter, createCallerFactory);
                break;
        }
    });

    // Listen for panel disposal to abort all in-flight work.
    panel.onDidDispose(() => {
        // Abort all in-flight queries/mutations so server-side procedures can stop early.
        for (const controller of activeOperations.values()) {
            controller.abort();
        }
        activeOperations.clear();

        // Abort active subscriptions and call `return()` on each iterator so async
        // generators terminate even when parked on `next()`. The abort signal alone
        // cannot unblock a parked `next()`; `return()` propagates through the
        // procedure's `for await` into any inner event sink and settles its pending
        // promise. Rejections from `return()` are swallowed because we have no useful
        // reaction during shutdown.
        for (const { abortController, iterator } of activeSubscriptions.values()) {
            abortController.abort();
            void Promise.resolve(iterator.return?.({ value: undefined, done: true })).catch(() => void 0);
        }
        activeSubscriptions.clear();
    });

    return { disposable, activeSubscriptions, activeOperations };
}

async function handleSubscriptionMessage<TContext extends BaseRouterContext, TRouter extends AnyRouter>(
    panel: vscode.WebviewPanel,
    message: VsCodeLinkRequestMessage,
    context: TContext,
    activeSubscriptions: Map<string, ActiveSubscription>,
    appRouter: TRouter,
    createCallerFactory: (router: TRouter) => (ctx: TContext) => Record<string, unknown>,
) {
    const abortController = new AbortController();

    try {
        // Clone the context so the per-operation signal is isolated and the shared
        // context object is never mutated. Without this, two concurrent subscriptions
        // would share the same `signal` field and aborting one would affect the other.
        const opContext: TContext = { ...context, signal: abortController.signal };

        const callerFactory = createCallerFactory(appRouter);
        const caller = callerFactory(opContext);
        const rawProcedure: unknown = caller[message.op.path];

        if (typeof rawProcedure !== 'function') {
            throw new Error(l10n.t('Procedure not found: {name}', { name: message.op.path }));
        }

        type SubscriptionCaller = (input: unknown) => Promise<unknown>;
        const procedure = rawProcedure as SubscriptionCaller;

        // Resolve the procedure result, then normalize to a live AsyncIterator so we
        // have a handle to call `return()` on `subscription.stop` and on panel
        // disposal. Using `for await (...)` would obtain the iterator internally
        // and give us no such handle, which means a consumer parked on a pending
        // `next()` (e.g. an event sink with no recent emit) would stay parked.
        const asyncIterable = await procedure(message.op.input);
        const iterator = toAsyncIterator(asyncIterable);

        // Only track the subscription once we actually have an iterator. If the
        // procedure lookup or the initial `await procedure(...)` throws, we fall
        // through to the outer catch without inserting an entry — so an early
        // failure cannot leave a stale entry behind for the lifetime of the panel.
        activeSubscriptions.set(message.id, { abortController, iterator });

        void (async () => {
            try {
                while (true) {
                    // Sequential next()/postMessage is required by the subscription protocol;
                    // parallelizing via Promise.all() would re-order or drop values.
                    // oxlint-disable-next-line no-await-in-loop
                    const result: IteratorResult<unknown> = await iterator.next();
                    if (result.done) {
                        break;
                    }
                    safePostMessage(panel, { id: message.id, result: result.value });
                }

                // On natural completion (procedure returned, or our `return()` propagated
                // through the generator), inform the client.
                safePostMessage(panel, { id: message.id, complete: true });
            } catch (error) {
                const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
                safePostMessage(panel, trpcErrorMessage);
            } finally {
                activeSubscriptions.delete(message.id);
            }
        })();
    } catch (error) {
        const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
        safePostMessage(panel, trpcErrorMessage);
    }
}

function handleSubscriptionStopMessage(
    message: VsCodeLinkRequestMessage,
    activeSubscriptions: Map<string, ActiveSubscription>,
) {
    const record = activeSubscriptions.get(message.id);
    if (record) {
        record.abortController.abort();
        // Cooperative abort cannot unblock a parked `iterator.next()`. Calling `return()`
        // here propagates through the procedure's async generator into any inner
        // `for await` (including TypedEventSink consumers), which settles parked
        // promises with `{ done: true }` and lets the streaming task exit cleanly.
        // We swallow rejection because we have no useful reaction.
        void Promise.resolve(record.iterator.return?.({ value: undefined, done: true })).catch(() => void 0);
        activeSubscriptions.delete(message.id);
    }
}

/**
 * Handles the 'abort' message type for queries and mutations.
 *
 * Looks up the active operation by ID and aborts its `AbortController`,
 * which propagates through `ctx.signal.aborted` so procedure bodies that
 * poll the signal (or pass it to the underlying SDK call) can cancel.
 */
function handleAbortMessage(message: VsCodeLinkRequestMessage, activeOperations: Map<string, AbortController>) {
    const abortController = activeOperations.get(message.id);
    if (abortController) {
        abortController.abort();
        activeOperations.delete(message.id);
    }
}

async function handleDefaultMessage<TContext extends BaseRouterContext, TRouter extends AnyRouter>(
    panel: vscode.WebviewPanel,
    message: VsCodeLinkRequestMessage,
    context: TContext,
    activeOperations: Map<string, AbortController>,
    appRouter: TRouter,
    createCallerFactory: (router: TRouter) => (ctx: TContext) => Record<string, unknown>,
) {
    const abortController = new AbortController();
    activeOperations.set(message.id, abortController);

    try {
        // Clone the context so the per-operation signal is isolated and concurrent
        // operations do not share (and stomp on) the same `signal` field.
        const opContext: TContext = { ...context, signal: abortController.signal };

        const callerFactory = createCallerFactory(appRouter);
        const caller = callerFactory(opContext);
        const rawProcedure: unknown = caller[message.op.path];

        if (typeof rawProcedure !== 'function') {
            throw new Error(l10n.t('Procedure not found: {name}', { name: message.op.path }));
        }

        type QueryCaller = (input: unknown) => Promise<unknown>;
        const procedure = rawProcedure as QueryCaller;
        const result = await procedure(message.op.input);

        // Skip the reply if the client aborted in the meantime — it has already
        // errored locally and does not care about the late response.
        if (!abortController.signal.aborted) {
            // Coalesce undefined → null so the `result` key survives structured-clone
            // serialisation over postMessage. The structured-clone algorithm strips
            // properties whose value is `undefined`, which would cause the client-side
            // observable to never fire `next` for void mutations and stay pending forever.
            const response = { id: message.id, result: result ?? null };
            safePostMessage(panel, response);
        }
    } catch (error) {
        if (!abortController.signal.aborted) {
            const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
            safePostMessage(panel, trpcErrorMessage);
        }
    } finally {
        activeOperations.delete(message.id);
    }
}
