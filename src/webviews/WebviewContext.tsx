import * as React from 'react';
import { createContext } from 'react';
import { WebviewApi } from 'vscode-webview';
import { Channel } from '../panels/Communication/Channel/Channel';
import { WebviewChannel } from '../panels/Communication/Channel/WebviewChannel';

export type WebviewContextValue = {
    channel: Channel;
};

export const webviewContextValue = (channel: Channel): WebviewContextValue => {
    return {
        channel,
    };
};

export const WebviewContext = createContext<WebviewContextValue>({} as WebviewContextValue);

export const WithWebviewContext = ({
    vscodeApi,
    children,
}: {
    vscodeApi: WebviewApi<unknown>;
    children: React.ReactNode;
}) => {
    const channel = new WebviewChannel(vscodeApi);
    return <WebviewContext.Provider value={webviewContextValue(channel)}>{children}</WebviewContext.Provider>;
};
