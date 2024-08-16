import * as React from 'react';
import { createContext, useContext, useReducer } from 'react';
import { type WebviewApi } from 'vscode-webview';
import { type CommandResult } from '../../panels/Commands';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { type WebviewState } from '../WebviewContext';

const DEFAULT_QUERY_VALUE = `SELECT * FROM c;`;

const defaultState: QueryEditorState = {
    dbName: '',
    dbNames: [],
    collectionName: '',
    collectionNames: [],
    currentExecutionId: '',
    queryHistory: [],
    queryValue: DEFAULT_QUERY_VALUE,
    isExecuting: false,
};

export type QueryEditorState = {
    dbName: string;
    dbNames: string[];
    collectionName: string;
    collectionNames: string[];
    currentExecutionId: string;
    queryHistory: string[];
    queryValue: string;

    isExecuting: boolean;
};

export type QueryEditorContextDispatcher = {
    runQuery: (query: string) => Promise<boolean>; // Run the query
    stopQuery: (executionId: string) => Promise<boolean>; // Stop the query

    openFile: () => Promise<void>; // Open a file
    saveToFile: (query: string) => Promise<boolean>; // Save to file

    setDatabase: (dbName: string) => void; // Change the database
    setCollection: (collectionName: string) => void; // Change the collection

    extractDatabaseNames: () => Promise<boolean>; // Get the names of the databases
    extractCollectionNames: (db: string) => Promise<boolean>; // Get the names of the db's collections

    showInformationMessage: (message: string) => void; // Show an information message
    showErrorMessage: (message: string) => void; // Show an error message
};

class QueryEditorContextDispatcherImpl implements QueryEditorContextDispatcher {
    constructor(
        private readonly channel: Channel,
        private readonly dispatch: (action: Partial<QueryEditorState>) => void,
    ) {
        this.initEventListeners();
    }

    public async runQuery(query: string): Promise<boolean> {
        const result = await this.sendCommand<CommandResult<string>>('runQuery', query);

        if (result && result.isSuccess) {
            this.dispatch({
                isExecuting: true,
                currentExecutionId: result.value,
            });
        }

        return result?.isSuccess ?? false;
    }
    public async stopQuery(executionId: string): Promise<boolean> {
        const result = await this.sendCommand<CommandResult<boolean>>('stopQuery', executionId);

        if (result && result.isSuccess) {
            this.dispatch({ isExecuting: false, currentExecutionId: '' });
        } else {
            this.dispatch({ isExecuting: true });
        }

        return result?.isSuccess ?? false;
    }

    public async openFile(): Promise<void> {
        await this.sendCommand<CommandResult<void>>('openFile');
    }
    public async saveToFile(query: string): Promise<boolean> {
        // We don't follow the new file, just create file and save it
        const result = await this.sendCommand<CommandResult<void>>('saveFile', query);

        return result?.isSuccess ?? false;
    }

    public setDatabase(dbName: string): void {
        this.dispatch({ dbName });
    }
    public setCollection(collectionName: string): void {
        this.dispatch({ collectionName });
    }

    public async extractDatabaseNames(): Promise<boolean> {
        const result = await this.sendCommand<CommandResult<void>>('getDatabaseNames');

        return result?.isSuccess ?? false;
    }
    public async extractCollectionNames(db: string): Promise<boolean> {
        const result = await this.sendCommand<CommandResult<void>>('getCollectionNames', db);

        return result?.isSuccess ?? false;
    }

    public async showInformationMessage(message: string) {
        await this.sendCommand<void>('showInformationMessage', message);
    }
    public async showErrorMessage(message: string) {
        await this.sendCommand<void>('showErrorMessage', message);
    }

    private async sendCommand<T>(command: string, ...args: unknown[]): Promise<T | null> {
        try {
            // Don't remove await here, we need to catch the error
            return await this.channel.postMessage<T>({
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

        return null;
    }

    private initEventListeners() {
        this.channel.on('fileOpened', (query: string) => {
            this.dispatch({ queryValue: query ?? '' });
        });
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
    const queryEditorReducer = (state: QueryEditorState, newState: Partial<QueryEditorState>): QueryEditorState => {
        return { ...state, ...newState };
    };
    const [state, dispatch] = useReducer(queryEditorReducer, { ...defaultState });
    const dispatcher = new QueryEditorContextDispatcherImpl(channel, dispatch);

    return (
        <QueryEditorContext.Provider value={state}>
            <QueryEditorDispatcherContext.Provider value={dispatcher}>{children}</QueryEditorDispatcherContext.Provider>
        </QueryEditorContext.Provider>
    );
};
