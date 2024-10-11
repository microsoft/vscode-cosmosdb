// hooks/useTrpcClient.ts
import { createTRPCClient, loggerLink } from '@trpc/client';
import { useContext, useEffect, useMemo } from 'react';
import { WebviewContext } from '../../WebviewContext';
import { type AppRouter } from '../configuration/appRouter';
import { vscodeLink, type VsCodeLinkNotification, type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from './vscodeLink';

export function useTrpcClient() {
    const { vscodeApi } = useContext(WebviewContext);

    // Create an EventTarget instance per webview
    const vscodeEventTarget = useMemo(() => new EventTarget(), []);

    function send(message: VsCodeLinkRequestMessage) {
        vscodeApi.postMessage(message);
    }

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
    const clientTrpc = useMemo(
        () =>
            createTRPCClient<AppRouter>({
                links: [loggerLink(), vscodeLink({ send, onReceive })],
            }),
        [vscodeApi],
    );

    // Set up a persistent notification handler
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

    return { clientTrpc, vscodeEventTarget };
}
