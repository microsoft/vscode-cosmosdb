/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toaster, useId, useToastController } from '@fluentui/react-components';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useReducer } from 'react';
import { useTrpcClient } from '../../../api/webview-client/useTrpcClient';
import { ErrorBoundary } from '../../../utils/ErrorBoundary';
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

export const WithDocumentContext = ({ children }: { children: ReactNode }) => {
    const toasterId = useId('toaster');
    const { dispatchToast } = useToastController(toasterId);
    const [state, dispatch] = useReducer(DocumentPanelDispatch, { ...defaultState });
    const { trpcClient } = useTrpcClient();

    const provider = useMemo(
        () => new DocumentContextProvider(dispatch, dispatchToast, trpcClient),
        [dispatchToast, trpcClient],
    );

    useEffect(() => {
        return () => provider.dispose();
    }, [provider]);

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
