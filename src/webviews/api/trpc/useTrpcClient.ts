/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTRPCClient, loggerLink, type TRPCClient as TRPCClientV11 } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { useCallback, useContext, useMemo } from 'react';
import { WebviewContext } from '../../WebviewContext';
import { errorLink, type ErrorHandler } from './errorLink';
import { vscodeLink, type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from './vscodeLink';

/**
 * Convenience alias for the tRPC client instance returned by
 * {@link useTrpcClient}. Useful when you need to thread the client
 * down through props or store it in a ref:
 *
 * ```ts
 * const clientRef = useRef<TrpcClient<QueryEditorAppRouter> | null>(null);
 * ```
 *
 * Aliases tRPC v11's `TRPCClient<TRouter>` (formerly `CreateTRPCClient`,
 * deprecated in v11 and slated for removal in v12).
 */
export type TrpcClient<TRouter extends AnyRouter> = TRPCClientV11<TRouter>;

/**
 * Options accepted by {@link useTrpcClient}.
 *
 * Options are passed as an object (rather than positional parameters)
 * so new fields can be added without breaking existing call sites. All
 * fields are optional — a bare `useTrpcClient<TRouter>()` call returns
 * a client with only the default link stack (`loggerLink` + `vscodeLink`).
 */
export interface UseTrpcClientOptions {
    /**
     * Invoked when a query or mutation surfaces an error through the
     * link pipeline. Subscriptions deliver their errors through the
     * caller's `subscribe({ onError })` callback and are intentionally
     * not forwarded here (see `errorLink.ts`).
     *
     * Note: changing this handler between renders rebuilds the
     * underlying tRPC client. Wrap in `useCallback` at the call site to
     * keep the client stable.
     */
    onError?: ErrorHandler;
}

/**
 * Custom React hook that provides a tRPC client for communication
 * between the webview and the VSCode extension host.
 *
 * @typeParam TRouter - The per-webview app router type (e.g.
 *                     `QueryEditorAppRouter`, `DocumentAppRouter`).
 * @param options    - See {@link UseTrpcClientOptions}.
 * @returns An object containing the tRPC client as `trpcClient`.
 *
 * @example
 * // No error handler — fire-and-forget calls only:
 * const { trpcClient } = useTrpcClient<MyRouter>();
 *
 * @example
 * // With an error handler that surfaces toasts:
 * const onError = useCallback((err) => toaster.error(err.message), [toaster]);
 * const { trpcClient } = useTrpcClient<MyRouter>({ onError });
 */
export function useTrpcClient<TRouter extends AnyRouter>(options: UseTrpcClientOptions = {}) {
    const { onError } = options;
    const { vscodeApi } = useContext(WebviewContext);

    /**
     * Function to send messages to the VSCode extension.
     *
     * @param message - The message to send, following the VsCodeLinkRequestMessage format.
     */
    const send = useCallback(
        (message: VsCodeLinkRequestMessage) => {
            vscodeApi.postMessage(message);
        },
        [vscodeApi],
    );

    /**
     * Function to handle incoming messages from the VSCode extension.
     * This function is provided to the tRPC client and is used internally to manage tRPC responses.
     *
     * @param callback - The callback to invoke when a tRPC response message is received.
     * @returns A function to unsubscribe the event listener.
     *
     * Note to code maintainers:
     * The tRPC client expects this `onReceive` function to handle the subscription and unsubscription
     * of the event listener for tRPC responses. It registers the handler when a tRPC request is made,
     * and unregisters it after the response is received.
     * Be cautious when modifying this function, as it could affect the tRPC client's ability to
     * receive responses correctly.
     */
    const onReceive = useCallback((callback: (message: VsCodeLinkResponseMessage) => void) => {
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
    }, []);

    // Use useMemo to avoid recreating the client on every render
    const trpcClient = useMemo<TrpcClient<TRouter>>(
        () =>
            createTRPCClient<TRouter>({
                links: [
                    loggerLink(),
                    ...(onError ? [errorLink<TRouter>(onError)] : []),
                    vscodeLink<TRouter>({ send, onReceive }),
                ],
            }),
        [onError, send, onReceive],
    );

    // Return the tRPC client
    return { trpcClient };
}
