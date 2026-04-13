/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toaster, useId, useToastController } from '@fluentui/react-components';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { type QueryEditorAppRouter } from '../../../../panels/trpc/appRouter';
import { useTrpcClient } from '../../../api/trpc/useTrpcClient';
import { ErrorBoundary } from '../../../utils/ErrorBoundary';
import { type BaseContextProvider } from '../../../utils/context/BaseContextProvider';
import { QueryEditorContextProvider } from './QueryEditorContextProvider';
import {
    type DispatchAction,
    type QueryEditorState,
    defaultState,
    dispatch as QueryEditorDispatch,
} from './QueryEditorState';

export const QueryEditorContext = createContext<QueryEditorState>(defaultState);
export const QueryEditorDispatcherContext = createContext<QueryEditorContextProvider>({} as QueryEditorContextProvider);
export const QueryEditorStateDispatchContext = createContext<React.Dispatch<DispatchAction> | undefined>(undefined);

export function useQueryEditorState() {
    return useContext(QueryEditorContext);
}

export function useQueryEditorDispatcher() {
    return useContext(QueryEditorDispatcherContext);
}

export function useQueryEditorStateDispatch(): React.Dispatch<DispatchAction> {
    const dispatch = useContext(QueryEditorStateDispatchContext);
    // This should never be undefined when used within WithQueryEditorContext
    const fallback: React.Dispatch<DispatchAction> = (action) => {
        console.error('QueryEditorStateDispatchContext not available', action);
    };
    return dispatch ?? fallback;
}

export const WithQueryEditorContext = ({ children }: { children: ReactNode }) => {
    const toasterId = useId('toaster');
    const { dispatchToast } = useToastController(toasterId);
    const [state, dispatch] = useReducer(QueryEditorDispatch, { ...defaultState });

    // Use a ref so the errorLink can forward errors to the provider once it's created.
    const providerRef = useRef<BaseContextProvider | null>(null);
    const onError = useMemo(
        () => (error: Error) => {
            void providerRef.current?.showErrorMessage(error.message);
        },
        [],
    );

    const { trpcClient } = useTrpcClient<QueryEditorAppRouter>(onError);

    const provider = useMemo(
        () => new QueryEditorContextProvider(dispatch, dispatchToast, trpcClient),
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
        <QueryEditorContext.Provider value={state}>
            <QueryEditorStateDispatchContext.Provider value={dispatch}>
                <QueryEditorDispatcherContext.Provider value={provider}>
                    <ErrorBoundary provider={provider}>
                        <Toaster toasterId={toasterId} />
                        {children}
                    </ErrorBoundary>
                </QueryEditorDispatcherContext.Provider>
            </QueryEditorStateDispatchContext.Provider>
        </QueryEditorContext.Provider>
    );
};
