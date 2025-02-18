/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTRPCClient, loggerLink } from '@trpc/client';
import { useContext, useMemo } from 'react';
import { WebviewContext } from '../../WebviewContext';
import { type AppRouter } from '../configuration/appRouter';
import { vscodeLink, type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from './vscodeLink';

/**
 * Custom React hook that provides a tRPC client for communication between the webview and VSCode extension.
 *
 * @returns An object containing the tRPC client (`trpcClient`)
 *
 * @example
 * // In your component:
 * import { useTrpcClient } from 'useTrpcClient';
 *
 * export const MyComponent = () => {
 *   const { trpcClient } = useTrpcClient();
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

    // Return the tRPC client
    return { trpcClient: trpcClient };
}
