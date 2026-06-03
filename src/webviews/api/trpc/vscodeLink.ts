/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TRPCClientError, type Operation, type TRPCLink } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable'; // Their example uses a reference from /server/ and so do we: https://trpc.io/docs/client/links#example
import { type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from '../../../panels/trpc/vscodeProtocol';

export type { VsCodeLinkRequestMessage, VsCodeLinkResponseMessage } from '../../../panels/trpc/vscodeProtocol';

interface VSCodeLinkOptions {
    //   Function to send a message to the server / extension
    send: (message: VsCodeLinkRequestMessage) => void;

    // Function to register a callback to receive messages from the server / extension
    onReceive: (onMessage: (message: VsCodeLinkResponseMessage) => void) => () => void; // Returns an unsubscribe function
}

/**
 * Creates a tRPC link that uses postMessage from vsCode for communication.
 * @param options - The options for the link, including send and onReceive functions.
 * @returns A tRPC link for client-side usage.
 */
function vscodeLink<TRouter extends AnyRouter>(options: VSCodeLinkOptions): TRPCLink<TRouter> {
    const { send, onReceive } = options;

    /**
     * Notes to maintainers:
     *  - types of messages have been derived from node_modules/@trpc/client/src/links/types.ts
     *    It was not straightforward to import them directly due to the use of `@trpc/server/unstable-core-do-not-import`
     *    TODO: Fell free to revisit once tRPC reaches version 11.0.0
     */

    // The link function required by tRPC client
    return (_runtime) => {
        // Since this is a terminating link, we do not deconstruct 'next'
        return ({ op }) => {
            /**
             * For each message sent from the client to the server, the function below will be called.
             * A separate event handler is created for each message to handle the response from the server
             * specific to that message.
             *
             * This approach differs from the typical design where a lookup table or map is used.
             * In the case of multiple messages sent in parallel, many individual event handlers
             * would be registered, and each response from the server would be passed to all event handlers.
             *
             * We could use a message dispatcher or a map to associate operationIds with
             * their respective handlers. This would be more efficient and scalable.
             *
             * This is not an issue in this case since our use case is quite simple. We are building
             * an interactive tool, not a high-performance server-client application.
             */
            return observable((observer) => {
                const operationId =
                    (op.context as { trpc?: { requestId?: string } })?.trpc?.requestId ??
                    Math.random().toString(16).substring(2);

                /**
                 * Handles incoming messages from the extension/server.
                 */
                const handleMessage = (message: VsCodeLinkResponseMessage) => {
                    // Ignore messages not related to this operation
                    if (message.id !== operationId) return;

                    if (message.error) {
                        observer.error(TRPCClientError.from(message.error));
                        return;
                    }

                    // Handle operation results
                    if (message.result !== undefined) {
                        const successResponse = {
                            result: {
                                data: message.result,
                            },
                        };

                        observer.next(successResponse);

                        // Complete the observer if it's not a subscription
                        if (op.type !== 'subscription') {
                            observer.complete();
                        }
                    }

                    // Handle completion signals for subscriptions
                    if (message.complete) {
                        observer.complete();
                    }
                };

                // Register the message handler to receive messages from the server
                const unsubscribe = onReceive(handleMessage);

                /**
                 * Abort-signal handling.
                 *
                 * tRPC populates `op.signal` when the caller provides `{ signal: AbortSignal }` in
                 * request options (e.g. `trpcClient.myQuery.query(input, { signal: ac.signal })`).
                 *
                 * Note: `op.signal` is a live AbortSignal on the client side — it is NOT serialized
                 * over postMessage. Instead, when the signal fires, we send an explicit 'abort' message
                 * to the extension host so it can cancel the server-side operation.
                 *
                 * For subscriptions we still use the existing `subscription.stop` cleanup path; the
                 * abort flow targets queries and mutations, which previously had no cancellation hook.
                 */

                /**
                 * `op.signal` is a live `AbortSignal` and is NOT cloneable via the structured-clone
                 * algorithm used by `postMessage`. Forwarding the op verbatim would throw
                 * `DataCloneError`. `sendSafe` strips it so the underlying `send()` only ever
                 * sees serialisable data. The signal itself is handled entirely on the client side
                 * via the `onAbort` listener below.
                 */
                const sendSafe = (message: VsCodeLinkRequestMessage): void => {
                    const { signal: _sig, ...safeOp } = message.op as Operation<unknown> & { signal?: unknown };
                    void _sig;
                    send({ ...message, op: safeOp as VsCodeLinkRequestMessage['op'] });
                };

                const onAbort = (): void => {
                    sendSafe({ id: operationId, op: { ...op, type: 'abort' } });
                    observer.error(TRPCClientError.from(new Error('Aborted')));
                };

                const opSignal = (op as { signal?: AbortSignal | null }).signal ?? null;
                if (opSignal) {
                    if (opSignal.aborted) {
                        // Signal was already aborted before the operation started — bail out
                        // without sending the original op, only the abort message.
                        onAbort();
                        return () => {
                            unsubscribe();
                        };
                    }
                    opSignal.addEventListener('abort', onAbort, { once: true });
                }

                // Send the operation to the server with a unique ID
                sendSafe({ id: operationId, op });

                // Return a cleanup function that is called when the observable is unsubscribed
                // This is relevant when working with subscriptions.
                return () => {
                    // If it's a subscription, send a stop message to the server
                    if (op.type === 'subscription') {
                        sendSafe({ id: operationId, op: { ...op, type: 'subscription.stop' } });
                    }
                    // Remove the abort listener so a late `ac.abort()` after natural completion
                    // does not send a stray 'abort' message for an operation that's already done.
                    opSignal?.removeEventListener('abort', onAbort);
                    // Cleanup the message handler
                    unsubscribe();
                };
            });
        };
    };
}

export { vscodeLink, VSCodeLinkOptions };
