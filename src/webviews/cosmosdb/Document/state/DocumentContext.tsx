/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toaster, useId, useToastController } from '@fluentui/react-components';
import { createContext, type ReactNode, useContext, useEffect, useReducer, useState } from 'react';
import { type WebviewApi } from 'vscode-webview';
import { type Channel } from '../../../../panels/Communication/Channel/Channel';
import { ErrorBoundary } from '../../../utils/ErrorBoundary';
import { type WebviewState } from '../../../WebviewContext';
import { DocumentContextProvider } from './DocumentContextProvider';
import { defaultState, dispatch as DocumentPanelDispatch, type DocumentState } from './DocumentState';

export const DocumentContext = createContext<DocumentState>(defaultState);
export const DocumentPanelDispatcherContext = createContext<DocumentContextProvider>({} as DocumentContextProvider);

export function useDocumentState() {
    return useContext(DocumentContext);
}

export function useDocumentDispatcher() {
    return useContext(DocumentPanelDispatcherContext);
}

export const WithDocumentContext = ({
    channel,
    children,
}: {
    channel: Channel;
    vscodeApi: WebviewApi<WebviewState>;
    children: ReactNode;
}) => {
    const toasterId = useId('toaster');
    const { dispatchToast } = useToastController(toasterId);
    const [state, dispatch] = useReducer(DocumentPanelDispatch, { ...defaultState });
    const [provider, setProvider] = useState<DocumentContextProvider>({} as DocumentContextProvider);

    useEffect(() => {
        const provider = new DocumentContextProvider(channel, dispatch, dispatchToast);
        setProvider(provider);

        return () => provider.dispose();
    }, [channel, dispatch, dispatchToast]);

    return (
        <DocumentContext.Provider value={state}>
            <DocumentPanelDispatcherContext.Provider value={provider}>
                <ErrorBoundary provider={provider}>
                    <Toaster toasterId={toasterId} />
                    {children}
                </ErrorBoundary>
            </DocumentPanelDispatcherContext.Provider>
        </DocumentContext.Provider>
    );
};
