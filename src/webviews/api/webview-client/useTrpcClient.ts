/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTRPCClient, loggerLink } from '@trpc/client';
import { useContext, useEffect, useMemo } from 'react';
import { WebviewContext } from '../../WebviewContext';
import { type AppRouter } from '../configuration/appRouter';
import {
    vscodeLink,
    type VsCodeLinkNotification,
    type VsCodeLinkRequestMessage,
    type VsCodeLinkResponseMessage,
} from './vscodeLink';

/**
 * Custom React hook that provides a tRPC client for communication between the webview and VSCode extension,
 * along with an event target for handling notifications from the extension.
 *
 * @returns An object containing the tRPC client (`trpcClient`) and an `EventTarget` (`vscodeEventTarget`)
 *          for listening to extension notifications.
 *
 * @example
 * // In your component:
 * import { useTrpcClient } from 'useTrpcClient';
 *
 * export const MyComponent = () => {
 *   const { trpcClient, vscodeEventTarget } = useTrpcClient();
 *
 *   // Listen for notifications from the extension
 *   useEffect(() => {
 *     const handleNotification = (event: Event) => {
 *       const customEvent = event as CustomEvent<VsCodeLinkNotification>;
 *       const notification = customEvent.detail;
 *       // Handle the notification data
 *       console.log('Received notification:', notification);
 *     };
 *
 *     vscodeEventTarget.addEventListener('VsCodeLinkNotification', handleNotification);
 *
 *     return () => {
 *       vscodeEventTarget.removeEventListener('VsCodeLinkNotification', handleNotification);
 *     };
 *   }, [vscodeEventTarget]);
 *
 *   // Use the tRPC client to make queries and mutations
 *   useEffect(() => {
 *     trpcClient.myProcedure.query().then((result) => {
 *       console.log('Procedure result:', result);
 *     });
 *   }, [trpcClient]);
 *
 *   return (
 *     <>
 *       { / * Your component's JSX * /}
 *     </>
 *   );
 * };
 */
export function useTrpcClient() {
    const { vscodeApi } = useContext(WebviewContext);

    // Create an EventTarget instance per webview to dispatch and listen to custom events
    const vscodeEventTarget = useMemo(() => new EventTarget(), []);

    /**
     * Function to send messages to the VSCode extension.
     *
     * @param message - The message to send, following the VsCodeLinkRequestMessage format.
     */
    function send(message: VsCodeLinkRequestMessage) {
        vscodeApi.postMessage(message);
    }

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
    function onReceive(callback: (message: VsCodeLinkResponseMessage) => void): () => void {
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
    }

    // Use useMemo to avoid recreating the client on every render
    // At the moment I'm not sure about the details of WebviewContext implementation,
    // so it's easier that way..
    const trpcClient = useMemo(
        () =>
            createTRPCClient<AppRouter>({
                links: [loggerLink(), vscodeLink({ send, onReceive })],
            }),
        [vscodeApi],
    );

    /**
     * Note to code maintainers:
     * This `useEffect` sets up a persistent listener for messages from the VSCode extension.
     * It specifically listens for messages of type 'VSLinkNotification' and dispatches them
     * as custom events on the `vscodeEventTarget`. This allows components to subscribe to
     * notifications from the extension.
     *
     * Be careful when modifying this handler, as it needs to correctly identify and process
     * notification messages without interfering with tRPC messages.
     */
    // Set up a persistent notification handler to listen for messages from the extension
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (event.data && typeof event.data === 'object' && event.data.type === 'VSLinkNotification') {
                // Dispatch the notification to the EventTarget
                const customEvent = new CustomEvent('VsCodeLinkNotification', {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    detail: event.data.payload as VsCodeLinkNotification,
                });
                vscodeEventTarget.dispatchEvent(customEvent);
            }
        };

        window.addEventListener('message', handler);
        return () => {
            window.removeEventListener('message', handler);
        };
    }, [vscodeEventTarget]);

    // Return the tRPC client and the event target for notifications
    return { trpcClient: trpcClient, vscodeEventTarget };
}
