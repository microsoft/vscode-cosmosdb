/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toaster, useId, useToastController } from '@fluentui/react-components';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { type WebviewApi } from 'vscode-webview';
import { type Channel } from '../../../../panels/Communication/Channel/Channel';
import { ErrorBoundary } from '../../../utils/ErrorBoundary';
import { type WebviewState } from '../../../WebviewContext';
import { QueryEditorContextProvider } from './QueryEditorContextProvider';
import { type QueryEditorState, defaultState, dispatch as QueryEditorDispatch } from './QueryEditorState';

export const QueryEditorContext = createContext<QueryEditorState>(defaultState);
export const QueryEditorDispatcherContext = createContext<QueryEditorContextProvider>({} as QueryEditorContextProvider);

export function useQueryEditorState() {
    return useContext(QueryEditorContext);
}

export function useQueryEditorDispatcher() {
    return useContext(QueryEditorDispatcherContext);
}

export const WithQueryEditorContext = ({
    channel,
    children,
}: {
    channel: Channel;
    vscodeApi: WebviewApi<WebviewState>;
    children: ReactNode;
}) => {
    const toasterId = useId('toaster');
    const { dispatchToast } = useToastController(toasterId);
    const [state, dispatch] = useReducer(QueryEditorDispatch, { ...defaultState });

    const provider = useMemo(
        () => new QueryEditorContextProvider(channel, dispatch, dispatchToast),
        [channel, dispatch, dispatchToast],
    );

    useEffect(() => {
        return () => provider.dispose();
    }, [provider]);

    return (
        <QueryEditorContext.Provider value={state}>
            <QueryEditorDispatcherContext.Provider value={provider}>
                <ErrorBoundary provider={provider}>
                    <Toaster toasterId={toasterId} />
                    {children}
                </ErrorBoundary>
            </QueryEditorDispatcherContext.Provider>
        </QueryEditorContext.Provider>
    );
};
