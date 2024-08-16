import * as React from 'react';
import { createContext } from 'react';
import { type WebviewApi } from 'vscode-webview';
import { type Channel } from '../panels/Communication/Channel/Channel';
import { WebviewChannel } from '../panels/Communication/Channel/WebviewChannel';

export type WebviewState = {
    noSqlDbName: string;
    noSqlCollectionName: string;
    noSqlQueryValue: string;
};

export type WebviewContextValue = {
    channel: Channel;
    vscodeApi: WebviewApi<WebviewState>;
};

export const WebviewContext = createContext<WebviewContextValue>({} as WebviewContextValue);

export const WithWebviewContext = ({
    vscodeApi,
    children,
}: {
    vscodeApi: WebviewApi<WebviewState>;
    children: React.ReactNode;
}) => {
    const channel = new WebviewChannel(vscodeApi);
    return <WebviewContext.Provider value={{ channel, vscodeApi }}>{children}</WebviewContext.Provider>;
};
