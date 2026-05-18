/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as React from 'react';
import { createContext } from 'react';
import { type WebviewApi } from 'vscode-webview';

export type WebviewState = object;

export type WebviewContextValue = {
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
    return <WebviewContext.Provider value={{ vscodeApi }}>{children}</WebviewContext.Provider>;
};
