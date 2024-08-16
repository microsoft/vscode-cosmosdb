import * as React from 'react';
import { createContext } from 'react';
import { type WebviewApi } from 'vscode-webview';
import { type CommandResult } from '../../panels/Commands/Command';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { type WebviewState } from '../WebviewContext';

const DEFAULT_QUERY_VALUE = `SELECT * FROM c;`;

export interface QueryEditorContextValue {
    dbName: string; // The name of the database
    collectionName: string; // The name of the collection
    isExecuting: boolean; // Whether the query is currently executing
    queryValue: string; // The value of the query editor

    runQuery: () => Promise<boolean>; // Run the query
    stopQuery: () => Promise<boolean>; // Stop the query

    openFile: () => Promise<string>; // Open a file
    saveFile: () => Promise<boolean>; // Save a file

    getCurrentDatabase: () => Promise<string>; // Get the current database
    getCurrentCollection: () => Promise<string>; // Get the current collection

    setDatabase: (dbName: string) => Promise<boolean>; // Change the database
    setCollection: (collectionName: string) => Promise<boolean>; // Change the collection

    getDatabaseNames: () => Promise<string[]>; // Get the names of the databases
    getCollectionNames: (db: string) => Promise<string[]>; // Get the names of the db's collections

    showInformationMessage: (message: string) => void; // Show an information message
    showErrorMessage: (message: string) => void; // Show an error message
}

class QueryEditorContextValueImpl implements QueryEditorContextValue {
    private channel: Channel;
    private vscodeApi: WebviewApi<WebviewState>;
    private currentExecutionId: string;

    public dbName = '';
    public collectionName = '';
    public isExecuting = false;
    public queryValue = '';

    constructor(channel: Channel, vscodeApi: WebviewApi<WebviewState>) {
        this.channel = channel;
        this.vscodeApi = vscodeApi;

        const currentState = vscodeApi.getState();
        if (currentState) {
            this.dbName = currentState.noSqlDbName;
            this.collectionName = currentState.noSqlCollectionName;
            this.queryValue = currentState.noSqlQueryValue;
        } else {
            this.initState();
        }
    }

    public async runQuery(): Promise<boolean> {
        const result = await this.sendCommand<CommandResult<string>>('runQuery');

        if (result && result.isSuccess) {
            this.isExecuting = true;
            this.currentExecutionId = result.value;
        }

        return this.isExecuting;
    }
    public async stopQuery(): Promise<boolean> {
        if (!this.isExecuting || !this.currentExecutionId) {
            return false;
        }

        const result = await this.sendCommand<CommandResult<boolean>>('stopQuery', this.currentExecutionId);

        if (result) {
            this.isExecuting = !result.isSuccess;
        }

        return !this.isExecuting;
    }

    public async openFile(): Promise<string> {
        const result = await this.sendCommand<CommandResult<string>>('openFile');

        if (result && result.isSuccess) {
            this.queryValue = result.value;
            this.updateState();
        }

        return this.queryValue;
    }
    public async saveFile(): Promise<boolean> {
        // We don't follow the new file, just create file and save it
        const result = await this.sendCommand<CommandResult<void>>('saveFile', this.queryValue);

        return result?.isSuccess ?? false;
    }

    public async getCurrentDatabase(): Promise<string> {
        if (!this.dbName) {
            const result = await this.sendCommand<CommandResult<string>>('getCurrentDatabase');
            if (result && result.isSuccess) {
                this.dbName = result.value;
                this.updateState();
            }
        }

        return this.dbName;
    }
    public async getCurrentCollection(): Promise<string> {
        if (!this.collectionName) {
            const result = await this.sendCommand<CommandResult<string>>('getCurrentCollection');
            if (result && result.isSuccess) {
                this.collectionName = result.value;
                this.updateState();
            }
        }

        return this.collectionName;
    }

    public async setDatabase(dbName: string): Promise<boolean> {
        const result = await this.sendCommand<CommandResult<boolean>>('setDatabase', dbName);

        if (result && result.isSuccess) {
            this.dbName = dbName;
            this.updateState();
        }

        return result?.isSuccess ?? false;
    }
    public async setCollection(collectionName: string): Promise<boolean> {
        const result = await this.sendCommand<CommandResult<boolean>>('setCollection', collectionName);

        if (result && result.isSuccess) {
            this.collectionName = collectionName;
            this.updateState();
        }

        return result?.isSuccess ?? false;
    }

    public async getDatabaseNames(): Promise<string[]> {
        const result = await this.sendCommand<CommandResult<string[]>>('getDatabaseNames');

        return result?.isSuccess ? result.value : [];
    }
    public async getCollectionNames(db: string): Promise<string[]> {
        const result = await this.sendCommand<CommandResult<string[]>>('getCollectionNames', db);

        return result?.isSuccess ? result.value : [];
    }

    public async showInformationMessage(message: string) {
        await this.sendCommand<void>('showInformationMessage', message);
    }
    public async showErrorMessage(message: string) {
        await this.sendCommand<void>('showErrorMessage', message);
    }

    private initState() {
        // Initialize the state
        // Send init request to main thread to get the current database and collection
        void Promise.resolve({
            dbName: 'testDb',
            collectionName: 'testCollection',
        }).then(({ dbName, collectionName }) => {
            this.dbName = dbName;
            this.collectionName = collectionName;
            this.queryValue = DEFAULT_QUERY_VALUE;

            this.updateState();
        });
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

    private updateState = () => {
        const currentState = this.vscodeApi.getState() ?? {};

        this.vscodeApi.setState({
            ...currentState,
            noSqlDbName: this.dbName,
            noSqlCollectionName: this.collectionName,
            noSqlQueryValue: this.queryValue,
        });
    };
}

export const QueryEditorContext = createContext<QueryEditorContextValue>({} as QueryEditorContextValue);

export const WithQueryEditorContext = ({
    channel,
    vscodeApi,
    children,
}: {
    channel: Channel;
    vscodeApi: WebviewApi<WebviewState>;
    children: React.ReactNode;
}) => {
    const value = new QueryEditorContextValueImpl(channel, vscodeApi);
    return <QueryEditorContext.Provider value={value}>{children}</QueryEditorContext.Provider>;
};
