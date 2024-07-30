import * as React from 'react';
import { createContext } from 'react';

export type WebviewContextValue = {};

export type WebviewApi = ReturnType<typeof acquireVsCodeApi>;

export const webviewContextValue = (_postMessage: (message: unknown) => void): WebviewContextValue => {
    return {
        // TODO: Implement the context value
    };
};

export const WebviewContext = createContext<WebviewContextValue>({} as WebviewContextValue);

export const WithWebviewContext = ({ vscodeApi, children }: { vscodeApi: WebviewApi; children: React.ReactNode }) => {
    return (
        <WebviewContext.Provider value={webviewContextValue(vscodeApi.postMessage)}>{children}</WebviewContext.Provider>
    );
};
