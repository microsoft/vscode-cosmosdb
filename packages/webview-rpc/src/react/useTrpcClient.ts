/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTRPCClient, loggerLink, type TRPCClient as TRPCClientV11 } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { useContext } from 'react';
import { type WebviewApi } from 'vscode-webview';
import {
    createEventChannel,
    errorLink,
    type RpcEventChannel,
    type RpcEventEmitter,
    vscodeLink,
    type VsCodeLinkRequestMessage,
    type VsCodeLinkResponseMessage,
} from '../client';
import { WebviewContext, type WebviewState } from './WebviewContext';

/**
 * Convenience alias for the tRPC client instance returned by
 * {@link useTrpcClient}. Useful when you need to thread the client
 * down through props or store it in a ref:
 *
 * ```ts
 * const clientRef = useRef<TrpcClient<AppRouter> | null>(null);
 * ```
 *
 * Aliases tRPC v11's `TRPCClient<TRouter>` (formerly `CreateTRPCClient`,
 * deprecated in v11 and slated for removal in v12).
 */
export type TrpcClient<TRouter extends AnyRouter> = TRPCClientV11<TRouter>;

/**
 * Shape returned by {@link useTrpcClient}. The pair is identity-stable
 * across renders and across multiple calls to the hook inside the same
 * webview — see the hook docstring for the cache strategy.
 */
export interface UseTrpcClientResult<TRouter extends AnyRouter> {
    /** The shared tRPC client for the current webview. */
    trpcClient: TrpcClient<TRouter>;
    /**
     * Cross-cutting observability channel for the client. Subscribe via
     * `events.onError(...)` / `onSuccess(...)` / `onAborted(...)` —
     * each call returns an unsubscribe function suitable for use as a
     * `useEffect` cleanup.
     */
    events: RpcEventChannel;
}

/**
 * Internal cache entry — keeps the runtime tRPC client (typed as
 * `unknown` because it varies per webview) and its event channel
 * paired together so they're always handed out as a unit.
 */
interface CacheEntry {
    trpcClient: unknown;
    events: RpcEventEmitter;
}

/**
 * Per-webview cache of `{ trpcClient, events }` pairs, keyed by the
 * `vscodeApi` handle (which is, by VS Code's design, a per-webview
 * singleton returned exactly once by `acquireVsCodeApi()`).
 *
 * A `WeakMap` gives us "one client per webview" naturally:
 *
 * - Two components calling `useTrpcClient` in the *same* webview share
 *   the same `vscodeApi` and therefore the same cache entry — so they
 *   get the same client and the same event channel. Subscribers from
 *   anywhere in the tree see every event.
 * - When the webview is disposed and the `vscodeApi` is garbage-
 *   collected, the cache entry is reclaimed automatically — no manual
 *   cleanup, no module-level leak between hot-reloads or tests.
 *
 * The `TRouter` generic is compile-time only — at runtime the client
 * is a tRPC proxy whose shape is identical for any router. We assume
 * (and the codebase enforces) one router per webview, so casting the
 * cached client to `TrpcClient<TRouter>` at the call site is sound.
 */
const clientCache = new WeakMap<WebviewApi<WebviewState>, CacheEntry>();

/**
 * Custom React hook that provides the shared tRPC client and event
 * channel for the current webview.
 *
 * Call it as many times as you like — every call inside the same
 * webview returns the **same** `{ trpcClient, events }` pair, so:
 *
 * - There is exactly one tRPC client per webview (no duplicate link
 *   stacks, no duplicate `postMessage` listeners).
 * - `events` is identity-stable across renders, which means
 *   `useEffect(() => events.onError(...), [events])` subscribes exactly
 *   once and unsubscribes on unmount.
 * - Cross-cutting handlers (toasts, ARIA announcements, telemetry) are
 *   subscribed via `events.onError(...)` / `onSuccess(...)` /
 *   `onAborted(...)` from anywhere in the component tree; every
 *   subscriber sees every event.
 *
 * @typeParam TRouter - The per-webview app router type.
 *
 * @example
 * ```tsx
 * const { trpcClient, events } = useTrpcClient<MyRouter>();
 *
 * useEffect(() => {
 *     const offError = events.onError((err, info) =>
 *         toaster.error(`${info.path}: ${err.message}`),
 *     );
 *     return offError;
 * }, [events, toaster]);
 * ```
 */
export function useTrpcClient<TRouter extends AnyRouter>(): UseTrpcClientResult<TRouter> {
    const { vscodeApi } = useContext(WebviewContext);

    let entry = clientCache.get(vscodeApi);
    if (!entry) {
        const events = createEventChannel();

        /**
         * Forward outbound RPC requests to the extension host. Closing
         * over `vscodeApi` is safe because the cache entry's lifetime
         * is bounded by the same handle — when `vscodeApi` is reclaimed
         * the entry goes with it.
         */
        const send = (message: VsCodeLinkRequestMessage) => {
            vscodeApi.postMessage(message);
        };

        /**
         * Register a single `window.message` listener and forward
         * tRPC-shaped envelopes to the supplied callback. tRPC calls
         * this once per in-flight request and uses the returned
         * disposer to clean up — see tRPC's `vscodeLink` contract.
         */
        const onReceive = (callback: (message: VsCodeLinkResponseMessage) => void) => {
            const handler = (event: MessageEvent) => {
                // a basic type guard here
                if ((event.data as VsCodeLinkResponseMessage).id) {
                    const message = event.data as VsCodeLinkResponseMessage;
                    callback(message);
                }
            };

            window.addEventListener('message', handler);
            return () => {
                window.removeEventListener('message', handler);
            };
        };

        const trpcClient = createTRPCClient<TRouter>({
            links: [loggerLink(), errorLink<TRouter>(events), vscodeLink<TRouter>({ send, onReceive })],
        });

        entry = { trpcClient, events };
        clientCache.set(vscodeApi, entry);
    }

    // Safe cast: see the WeakMap docstring above — at runtime the
    // client is a router-agnostic proxy, and one webview has one router
    // by construction.
    return {
        trpcClient: entry.trpcClient as TrpcClient<TRouter>,
        events: entry.events,
    };
}
