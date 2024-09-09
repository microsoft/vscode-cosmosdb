import {
    Link,
    Toast,
    ToastBody,
    Toaster,
    ToastTitle,
    ToastTrigger,
    useId,
    useToastController,
} from '@fluentui/react-components';
import type * as React_2 from 'react';
import * as React from 'react';
import { createContext, useContext, useEffect, useReducer } from 'react';
import { type WebviewApi } from 'vscode-webview';
import { type SerializedQueryResult } from '../../docdb/types/queryResult';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { type WebviewState } from '../WebviewContext';

export const DEFAULT_QUERY_VALUE = `SELECT * FROM c`;
export const QUERY_HISTORY_SIZE = 10;
export const DEFAULT_PAGE_SIZE = 100;

const defaultState: QueryEditorState = {
    dbName: '',
    collectionName: '',
    currentExecutionId: '',
    queryHistory: [],
    queryValue: DEFAULT_QUERY_VALUE,
    isConnected: false,
    isExecuting: false,

    // Result state
    pageNumber: 1,
    pageSize: DEFAULT_PAGE_SIZE,

    currentQueryResult: null,

    tableViewMode: 'Tree',
    editMode: 'View',
};

export type TableViewMode = 'Tree' | 'JSON' | 'Table';
export type EditMode = 'View' | 'Edit';

export type DispatchAction =
    | {
          type: 'insertText';
          queryValue: string;
      }
    | {
          type: 'databaseConnected';
          dbName: string;
          collectionName: string;
      }
    | {
          type: 'databaseDisconnected';
      }
    | {
          type: 'executionStarted';
          executionId: string;
      }
    | {
          type: 'executionStopped';
          executionId: string;
      }
    | {
          type: 'appendQueryHistory';
          queryValue: string;
      }
    | {
          type: 'setPageSize';
          pageSize: number;
      }
    | {
          type: 'setPageNumber';
          pageNumber: number;
      }
    | {
          type: 'updateQueryResult';
          executionId: string;
          result: SerializedQueryResult;
      }
    | {
          type: 'setTableViewMode';
          mode: TableViewMode;
      }
    | {
          type: 'setEditMode';
          mode: EditMode;
      };

export type QueryEditorState = {
    dbName: string; // Database which is currently selected
    collectionName: string; // Collection which is currently selected
    currentExecutionId: string;
    queryHistory: string[];
    queryValue: string;
    isConnected: boolean;
    isExecuting: boolean;

    // Result state
    pageNumber: number;
    pageSize: number;

    currentQueryResult: SerializedQueryResult | null;

    tableViewMode: TableViewMode;
    editMode: EditMode;
};

export type QueryEditorContextDispatcher = {
    runQuery: (query: string) => Promise<void>; // Run the query
    stopQuery: (executionId: string) => Promise<void>; // Stop the query

    openFile: () => Promise<void>; // Open a file
    saveToFile: (query: string) => Promise<void>; // Save to file
    insertText: (text: string) => void; // Insert text to the editor

    connectToDatabase: () => Promise<void>; // Connect to the database
    disconnectFromDatabase: () => Promise<void>; // Disconnect from the database

    showInformationMessage: (message: string) => Promise<void>; // Show an information message
    showErrorMessage: (message: string) => Promise<void>; // Show an error message

    setPageSize: (pageSize: number) => void; // Set the page size
    setPageNumber: (pageNumber: number) => void; // Set the page number

    setTableViewMode: (mode: TableViewMode) => void; // Set the table view mode
    setEditMode: (mode: EditMode) => void; // Set the edit mode

    dispose: () => void;
};

class QueryEditorContextDispatcherImpl implements QueryEditorContextDispatcher {
    static dispatcher(state: QueryEditorState, action: DispatchAction): QueryEditorState {
        switch (action.type) {
            case 'insertText':
                return { ...state, queryValue: action.queryValue };
            case 'databaseConnected':
                return { ...state, isConnected: true, dbName: action.dbName, collectionName: action.collectionName };
            case 'databaseDisconnected':
                return { ...state, isConnected: false, dbName: '', collectionName: '' };
            case 'executionStarted':
                return { ...state, isExecuting: true, currentExecutionId: action.executionId };
            case 'executionStopped': {
                if (action.executionId !== state.currentExecutionId) {
                    return state;
                }
                return { ...state, isExecuting: false, currentExecutionId: '' };
            }
            case 'appendQueryHistory': {
                const queryHistory = [...state.queryHistory, action.queryValue].filter(
                    (value, index, self) => self.indexOf(value) === index,
                );
                if (queryHistory.length > QUERY_HISTORY_SIZE) {
                    queryHistory.shift();
                }
                return { ...state, queryHistory };
            }
            case 'setPageSize':
                return { ...state, pageSize: action.pageSize };
            case 'setPageNumber':
                return { ...state, pageNumber: action.pageNumber };
            case 'updateQueryResult':
                return { ...state, currentQueryResult: action.result };
            case 'setTableViewMode':
                return { ...state, tableViewMode: action.mode };
            case 'setEditMode':
                return { ...state, editMode: action.mode };
        }
    }

    constructor(
        private readonly channel: Channel,
        private readonly dispatch: (action: DispatchAction) => void,
        private readonly dispatchToast: (content: React_2.ReactNode, options?: unknown) => void,
    ) {
        this.initEventListeners();
        void this.channel.postMessage({ type: 'event', name: 'ready', params: [] });
    }

    public async runQuery(query: string): Promise<void> {
        this.dispatch({ type: 'appendQueryHistory', queryValue: query });
        await this.sendCommand('runQuery', query, {});
    }
    public async stopQuery(executionId: string): Promise<void> {
        await this.sendCommand('stopQuery', executionId);
    }

    public async openFile(): Promise<void> {
        await this.sendCommand('openFile');
    }
    public async saveToFile(query: string): Promise<void> {
        await this.sendCommand('saveFile', query);
    }
    public insertText(query: string): void {
        this.dispatch({ type: 'insertText', queryValue: query ?? '' });
    }

    public async connectToDatabase(): Promise<void> {
        await this.sendCommand('connectToDatabase');
    }
    public async disconnectFromDatabase(): Promise<void> {
        await this.sendCommand('disconnectFromDatabase');
    }

    public async showInformationMessage(message: string) {
        await this.sendCommand('showInformationMessage', message);
    }
    public async showErrorMessage(message: string) {
        await this.sendCommand('showErrorMessage', message);
    }

    public setPageSize(pageSize: number) {
        this.dispatch({ type: 'setPageSize', pageSize });
    }
    public setPageNumber(pageNumber: number) {
        this.dispatch({ type: 'setPageNumber', pageNumber });
    }

    public setTableViewMode(mode: TableViewMode) {
        this.dispatch({ type: 'setTableViewMode', mode });
    }

    public setEditMode(mode: EditMode) {
        this.dispatch({ type: 'setEditMode', mode });
    }

    private async sendCommand(command: string, ...args: unknown[]): Promise<void> {
        try {
            // Don't remove await here, we need to catch the error
            await this.channel.postMessage({
                type: 'request',
                name: 'command',
                params: [
                    {
                        commandName: command,
                        params: args,
                    },
                ],
            });
        } catch (error) {
            try {
                await this.showErrorMessage(`Failed to execute command ${command}: ${error}`);
            } catch {
                // Ignore
            }
        }
    }

    private initEventListeners() {
        this.channel.on('fileOpened', (query: string) => {
            this.insertText(query);
        });

        this.channel.on('databaseConnected', (dbName: string, collectionName: string) => {
            this.dispatch({ type: 'databaseConnected', dbName, collectionName });
        });

        this.channel.on('databaseDisconnected', () => {
            this.dispatch({ type: 'databaseDisconnected' });
        });

        this.channel.on('executionStarted', (executionId: string) => {
            this.dispatch({ type: 'executionStarted', executionId });
        });

        this.channel.on('executionStopped', (executionId: string) => {
            this.dispatch({ type: 'executionStopped', executionId });
        });

        this.channel.on('queryResults', (executionId: string, result: SerializedQueryResult) => {
            this.dispatch({ type: 'updateQueryResult', executionId, result });
            this.dispatch({ type: 'executionStopped', executionId });
        });

        this.channel.on('queryError', (executionId: string, error: string) => {
            this.dispatch({ type: 'executionStopped', executionId });
            this.dispatchToast(
                <Toast>
                    <ToastTitle
                        action={
                            <ToastTrigger>
                                <Link>Dismiss</Link>
                            </ToastTrigger>
                        }>
                        Query error
                    </ToastTitle>
                    <ToastBody>{error}</ToastBody>
                </Toast>,
                {
                    intent: 'error',
                    pauseOnHover: true,
                    pauseOnWindowBlur: true,
                    timeout: 5000,
                },
            );
        });
    }

    public dispose() {
        this.channel.removeAllListeners();
    }
}

export const QueryEditorContext = createContext<QueryEditorState>(defaultState);
export const QueryEditorDispatcherContext = createContext<QueryEditorContextDispatcher>(
    {} as QueryEditorContextDispatcher,
);

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
    const [state, dispatch] = useReducer(QueryEditorContextDispatcherImpl.dispatcher, { ...defaultState });
    const [dispatcher, setDispatcher] = React.useState<QueryEditorContextDispatcher>(
        {} as QueryEditorContextDispatcher,
    );
    const toasterId = useId('toaster');
    const { dispatchToast } = useToastController(toasterId);

    useEffect(() => {
        const dispatcher = new QueryEditorContextDispatcherImpl(channel, dispatch, dispatchToast);
        setDispatcher(dispatcher);

        return () => dispatcher.dispose();
    }, [channel, dispatch, dispatchToast]);

    return (
        <QueryEditorContext.Provider value={state}>
            <QueryEditorDispatcherContext.Provider value={dispatcher}>
                <Toaster toasterId={toasterId} />
                {children}
            </QueryEditorDispatcherContext.Provider>
        </QueryEditorContext.Provider>
    );
};
