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
import { ItemContextProvider } from './ItemContextProvider';
import { defaultState, dispatch as ItemPanelDispatch, type ItemState } from './ItemState';

export const ItemContext = createContext<ItemState>(defaultState);
export const ItemPanelDispatcherContext = createContext<ItemContextProvider>({} as ItemContextProvider);

export function useItemState() {
    return useContext(ItemContext);
}

export function useItemDispatcher() {
    return useContext(ItemPanelDispatcherContext);
}

export const WithItemContext = ({
    channel,
    children,
}: {
    channel: Channel;
    vscodeApi: WebviewApi<WebviewState>;
    children: ReactNode;
}) => {
    const toasterId = useId('toaster');
    const { dispatchToast } = useToastController(toasterId);
    const [state, dispatch] = useReducer(ItemPanelDispatch, { ...defaultState });
    const [provider, setProvider] = useState<ItemContextProvider>({} as ItemContextProvider);

    useEffect(() => {
        const provider = new ItemContextProvider(channel, dispatch, dispatchToast);
        setProvider(provider);

        return () => provider.dispose();
    }, [channel, dispatch, dispatchToast]);

    return (
        <ItemContext.Provider value={state}>
            <ItemPanelDispatcherContext.Provider value={provider}>
                <ErrorBoundary provider={provider}>
                    <Toaster toasterId={toasterId} />
                    {children}
                </ErrorBoundary>
            </ItemPanelDispatcherContext.Provider>
        </ItemContext.Provider>
    );
};
