// hooks/useTrpcClient.ts
import { createTRPCClient, loggerLink } from '@trpc/client';
import { useContext, useMemo } from 'react';
import { WebviewContext } from '../../WebviewContext';
import { type AppRouter } from '../configuration/appRouter';
import {
    vscodeLink,
    type VsCodeLinkNotification,
    type VsCodeLinkRequestMessage,
    type VsCodeLinkResponseMessage,
} from './vscodeLink';

export function useTrpcClient() {
    const { vscodeApi } = useContext(WebviewContext);

    // Create an EventTarget instance per webview
    const vscodeEventTarget = useMemo(() => new EventTarget(), []);

    function send(message: VsCodeLinkRequestMessage) {
        vscodeApi.postMessage(message);
    }

    function onReceive(callback: (message: VsCodeLinkResponseMessage) => void): () => void {
        const handler = (event: MessageEvent) => {
            if ((event.data as VsCodeLinkNotification).notification) {
                // 1. Catch our VsCodeLinkNotification messages and pipe them to the webview directly
                const customEvent = new CustomEvent('VsCodeLinkNotification', {
                    detail: event.data as VsCodeLinkNotification,
                });
                vscodeEventTarget.dispatchEvent(customEvent);

                return;
            }

            // 2. It's not a VsCodeLinkNotification, so it must be a VsCodeLinkResponseMessage
            //    ==> continue with tRPC message handling
            const message = event.data as VsCodeLinkResponseMessage;
            callback(message);
        };

        window.addEventListener('message', handler);
        return () => {
            window.removeEventListener('message', handler);
        };
    }

    // Use useMemo to avoid recreating the client on every render
    // At the moment I'm not sure about the details of WebviewContext implementation,
    // so it's easier that way..
    const clientTrpc = useMemo(
        () =>
            createTRPCClient<AppRouter>({
                links: [loggerLink(), vscodeLink({ send, onReceive })],
            }),
        [vscodeApi],
    );

    return { clientTrpc, vscodeEventTarget };
}
