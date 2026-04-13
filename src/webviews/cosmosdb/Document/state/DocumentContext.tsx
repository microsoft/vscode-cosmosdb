/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toaster, useId, useToastController } from '@fluentui/react-components';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { type DocumentAppRouter } from '../../../../panels/trpc/appRouter';
import { useTrpcClient } from '../../../api/trpc/useTrpcClient';
import { ErrorBoundary } from '../../../utils/ErrorBoundary';
import { type BaseContextProvider } from '../../../utils/context/BaseContextProvider';
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

    // Use a ref so the errorLink can forward errors to the provider once it's created.
    const providerRef = useRef<BaseContextProvider | null>(null);
    const onError = useMemo(
        () => (error: Error) => {
            void providerRef.current?.showErrorMessage(error.message);
        },
        [],
    );

    const { trpcClient } = useTrpcClient<DocumentAppRouter>(onError);

    const provider = useMemo(
        () => new DocumentContextProvider(dispatch, dispatchToast, trpcClient),
        [dispatchToast, trpcClient],
    );

    // Keep the ref pointing at the current provider so errorLink can forward errors.
    useEffect(() => {
        providerRef.current = provider;
        return () => {
            providerRef.current = null;
        };
    }, [provider]);

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
