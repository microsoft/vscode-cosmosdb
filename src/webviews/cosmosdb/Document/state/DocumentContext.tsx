/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@cosmosdb/webview-rpc/react';
import { Toaster, useId, useToastController } from '@fluentui/react-components';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { type DocumentAppRouter } from '../../../../panels/trpc/appRouter';
import { type BaseContextProvider } from '../../../utils/context/BaseContextProvider';
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

    // Use a ref so the central error subscriber can forward errors to the
    // provider once it's created (the provider is built below from
    // `trpcClient`, so it does not exist yet on the first render).
    const providerRef = useRef<BaseContextProvider | null>(null);

    const { trpcClient, events } = useTrpcClient<DocumentAppRouter>();

    const provider = useMemo(
        () => new DocumentContextProvider(dispatch, dispatchToast, trpcClient),
        [dispatchToast, trpcClient],
    );

    // Keep the ref pointing at the current provider so the onError
    // subscriber below can forward errors to it.
    useEffect(() => {
        providerRef.current = provider;
        return () => {
            providerRef.current = null;
        };
    }, [provider]);

    // Subscribe to the shared event channel exactly once — `events` is
    // identity-stable across renders by `useTrpcClient`'s WeakMap cache.
    useEffect(() => {
        return events.onError((error) => {
            void providerRef.current?.showErrorMessage(error.message);
        });
    }, [events]);

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
