/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TRPCClientError, type Operation, type TRPCLink } from '@trpc/client';
// eslint-disable-next-line import/no-internal-modules
import { observable } from '@trpc/server/observable'; // Their example uses a reference from /server/ and so do we: https://trpc.io/docs/client/links#example
import { type AppRouter } from '../configuration/appRouter';

type StopOperation<TInput = unknown> = Omit<Operation<TInput>, 'type'> & {
    type: 'subscription.stop';
};

/**
 * Messages sent from the webview/client to the extension/server.
 * @id - A unique identifier for the message/
 */
export interface VsCodeLinkRequestMessage {
    id: string;
    // TODO, when tRPC v12 is released, 'subscription.stop' should be supported natively, until then, we're adding it manually.
    op: Operation<unknown> | StopOperation<unknown>;
}

/**
 * Messages sent back from the extension/server to the webview/client.
 * Each message sent back is a **response** to a previous message VsCodeLinkRequestMessage
 *
 * @id - The unique identifier of the message from the original request
 */
export interface VsCodeLinkResponseMessage {
    id: string;
    result?: unknown;
    error?: {
        name: string;
        message: string;

        code?: number;
        stack?: string;
        cause?: unknown;
        data?: unknown;
    };
    complete?: boolean;
}

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
function vscodeLink(options: VSCodeLinkOptions): TRPCLink<AppRouter> {
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
            op = op as Operation<unknown>;

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
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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

                // Send the operation to the server with a unique ID
                send({ id: operationId, op });

                // Return a cleanup function that is called when the observable is unsubscribed
                // This is relevant when working with subscriptions.
                return () => {
                    // If it's a subscription, send a stop message to the server
                    if (op.type === 'subscription') {
                        send({ id: operationId, op: { ...op, type: 'subscription.stop' } });
                    }
                    // Cleanup the message handler
                    unsubscribe();
                };
            });
        };
    };
}

export { vscodeLink, VSCodeLinkOptions };
