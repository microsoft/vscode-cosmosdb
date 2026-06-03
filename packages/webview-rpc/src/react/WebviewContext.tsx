/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as React from 'react';
import { createContext, useMemo } from 'react';
import { type WebviewApi } from 'vscode-webview';

export type WebviewState = object;

export type WebviewContextValue = {
    vscodeApi: WebviewApi<WebviewState>;
};

/**
 * React context that exposes the per-webview `vscodeApi` handle
 * (returned by `acquireVsCodeApi()` in the webview bootstrap) to any
 * descendant component. Consumers use `useContext(WebviewContext)` —
 * typically via the {@link useTrpcClient} hook, which reads it under
 * the hood.
 *
 * The default value is `{} as WebviewContextValue` — components must
 * be rendered inside a {@link WithWebviewContext} (or another provider
 * of this context) for the API to be usable.
 */
export const WebviewContext = createContext<WebviewContextValue>({} as WebviewContextValue);

/**
 * Provider component that wraps its children in a
 * {@link WebviewContext.Provider} pre-filled with the given `vscodeApi`.
 *
 * Use it at the top of every webview entry point to avoid repeating
 * the provider JSX in each panel:
 *
 * ```tsx
 * const vscodeApi = acquireVsCodeApi<WebviewState>();
 *
 * createRoot(document.getElementById('root')!).render(
 *     <WithWebviewContext vscodeApi={vscodeApi}>
 *         <App />
 *     </WithWebviewContext>,
 * );
 * ```
 */
export const WithWebviewContext = ({
    vscodeApi,
    children,
}: {
    vscodeApi: WebviewApi<WebviewState>;
    children: React.ReactNode;
}) => {
    // Memoize the context value so consumers do not re-render on every
    // parent render. `vscodeApi` is stable across the lifetime of the
    // webview (it's the result of `acquireVsCodeApi()`, which the host
    // guarantees to be idempotent), so a single-deps `useMemo` keeps the
    // value identity-stable forever.
    const value = useMemo<WebviewContextValue>(() => ({ vscodeApi }), [vscodeApi]);
    return <WebviewContext.Provider value={value}>{children}</WebviewContext.Provider>;
};
