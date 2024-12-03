/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import {
    DEFAULT_EXECUTION_TIMEOUT,
    DEFAULT_PAGE_SIZE,
    type ResultViewMetadata,
    type SerializedQueryResult,
} from '../../../docdb/types/queryResult';
import { type Channel } from '../../../panels/Communication/Channel/Channel';
import { type OpenDocumentMode } from '../../Document/state/DocumentState';
import { BaseContextProvider } from '../../utils/context/BaseContextProvider';
import { type DispatchAction, type TableViewMode } from './QueryEditorState';

const DEFAULT_RESULT_VIEW_METADATA: ResultViewMetadata = {
    countPerPage: DEFAULT_PAGE_SIZE,
    timeout: DEFAULT_EXECUTION_TIMEOUT,
};

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
        await this.sendCommand('runQuery', query, { ...DEFAULT_RESULT_VIEW_METADATA, ...options });
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
    public async duplicateTab(text: string): Promise<void> {
        await this.sendCommand('duplicateTab', text);
    }
    public insertText(query: string): void {
        this.dispatch({ type: 'insertText', queryValue: query ?? '' });
    }
    public setSelectedText(query: string): void {
        this.dispatch({ type: 'setQuerySelectedValue', selectedValue: query });
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
    }
    public setSelectedRows(selectedRows: number[]) {
        void this.reportWebviewEvent('setSelectedDocumentIds', { count: selectedRows.length.toString() });
        this.dispatch({ type: 'setSelectedRows', selectedRows });
    }

    public async openDocument(executionId: string, mode: OpenDocumentMode, row?: number): Promise<void> {
        await this.sendCommand('openDocument', executionId, mode, row);
    }
    public async openDocuments(executionId: string, mode: OpenDocumentMode, rows: number[]): Promise<void> {
        for (const row of rows) {
            await this.openDocument(executionId, mode, row);
        }
    }
    public async deleteDocument(executionId: string, row: number): Promise<void> {
        await this.sendCommand('deleteDocument', executionId, row);
    }
    public async deleteDocuments(executionId: string, rows: number[]): Promise<void> {
        for (const row of rows) {
            await this.deleteDocument(executionId, row);
        }
    }

    protected initEventListeners() {
        super.initEventListeners();

        this.channel.on('fileOpened', (query: string) => {
            this.insertText(query);
        });

        this.channel.on(
            'databaseConnected',
            (dbName: string, collectionName: string, partitionKey?: PartitionKeyDefinition) => {
                this.dispatch({ type: 'databaseConnected', dbName, collectionName, partitionKey });
            },
        );

        this.channel.on('databaseDisconnected', () => {
            this.dispatch({ type: 'databaseDisconnected' });
        });

        this.channel.on('executionStarted', (executionId: string, startExecutionTime: number) => {
            this.dispatch({ type: 'executionStarted', executionId, startExecutionTime });
        });

        this.channel.on('executionStopped', (executionId: string, endExecutionTime: number) => {
            this.dispatch({ type: 'executionStopped', executionId, endExecutionTime });
        });

        this.channel.on('queryResults', (executionId: string, result: SerializedQueryResult, currentPage: number) => {
            this.dispatch({ type: 'updateQueryResult', executionId, result, currentPage });
        });

        //TODO: there should be no queryError event that needs to show a toast,
        //      all errors should be handled by QuerySession and dispatched to host error handling.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        this.channel.on('queryError', (_executionId: string, _error: string) => {
            //this.showToast('Query error', error, 'error');
        });
    }
}
