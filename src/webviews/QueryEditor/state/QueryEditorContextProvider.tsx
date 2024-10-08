/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ResultViewMetadata, type SerializedQueryResult } from '../../../docdb/types/queryResult';
import { type Channel } from '../../../panels/Communication/Channel/Channel';
import { BaseContextProvider } from '../../utils/context/BaseContextProvider';
import { type DispatchAction, type EditMode, type TableViewMode } from './QueryEditorState';

export class QueryEditorContextProvider extends BaseContextProvider {
    constructor(
        channel: Channel,
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: (content: React.ReactNode, options?: unknown) => void,
    ) {
        super(channel, dispatchToast);
    }

    public async runQuery(query: string, options: ResultViewMetadata): Promise<void> {
        this.dispatch({ type: 'appendQueryHistory', queryValue: query });
        await this.sendCommand('runQuery', query, options);
    }
    public async stopQuery(executionId: string): Promise<void> {
        await this.sendCommand('stopQuery', executionId);
    }
    public async nextPage(executionId: string): Promise<void> {
        await this.sendCommand('nextPage', executionId);
    }
    public async prevPage(executionId: string): Promise<void> {
        await this.sendCommand('prevPage', executionId);
    }
    public async firstPage(executionId: string): Promise<void> {
        await this.sendCommand('firstPage', executionId);
    }

    public async openFile(): Promise<void> {
        await this.sendCommand('openFile');
    }
    public async copyToClipboard(text: string): Promise<void> {
        await this.sendCommand('copyToClipboard', text);
    }
    public async saveToFile(text: string, filename: string, ext: string): Promise<void> {
        await this.sendCommand('saveFile', text, filename, ext);
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

    public setPageSize(pageSize: number) {
        void this.reportWebviewEvent('setPageSize', { pageSize: pageSize.toString() });
        this.dispatch({ type: 'setPageSize', pageSize });
    }

    public setTableViewMode(mode: TableViewMode) {
        void this.reportWebviewEvent('setTableViewMode', { mode });
        this.dispatch({ type: 'setTableViewMode', mode });
        this.dispatch({ type: 'setEditMode', mode: 'View' });
    }
    public setEditMode(mode: EditMode) {
        void this.reportWebviewEvent('setEditMode', { mode });
        this.dispatch({ type: 'setEditMode', mode });

        if (mode === 'Edit') {
            // While in edit mode, switch to table view
            this.dispatch({ type: 'setTableViewMode', mode: 'Table' });
        }
    }
    public setSelectedDocumentIds(documentIds: string[]) {
        void this.reportWebviewEvent('setSelectedDocumentIds', { count: documentIds.length.toString() });
        this.dispatch({ type: 'setSelectedDocumentIds', documentIds });
    }

    protected initEventListeners() {
        super.initEventListeners();

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

        this.channel.on('queryResults', (executionId: string, result: SerializedQueryResult, currentPage: number) => {
            this.dispatch({ type: 'updateQueryResult', executionId, result, currentPage });
            this.dispatch({ type: 'executionStopped', executionId });
        });

        this.channel.on('queryError', (executionId: string, error: string) => {
            this.dispatch({ type: 'executionStopped', executionId });
            this.showToast('Query error', error, 'error');
        });
    }
}
