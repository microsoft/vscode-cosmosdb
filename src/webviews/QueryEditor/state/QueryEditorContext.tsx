import { Toaster, useId, useToastController } from '@fluentui/react-components';
import * as React from 'react';
import { createContext, useContext, useEffect, useReducer } from 'react';
import { type WebviewApi } from 'vscode-webview';
import { type Channel } from '../../../panels/Communication/Channel/Channel';
import { type WebviewState } from '../../WebviewContext';
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
    children: React.ReactNode;
}) => {
    const toasterId = useId('toaster');
    const { dispatchToast } = useToastController(toasterId);
    const [state, dispatch] = useReducer(QueryEditorDispatch, { ...defaultState });
    const [provider, setProvider] = React.useState<QueryEditorContextProvider>({} as QueryEditorContextProvider);

    useEffect(() => {
        const provider = new QueryEditorContextProvider(channel, dispatch, dispatchToast);
        setProvider(provider);

        return () => provider.dispose();
    }, [channel, dispatch, dispatchToast]);

    return (
        <QueryEditorContext.Provider value={state}>
            <QueryEditorDispatcherContext.Provider value={provider}>
                <Toaster toasterId={toasterId} />
                {children}
            </QueryEditorDispatcherContext.Provider>
        </QueryEditorContext.Provider>
    );
};
