/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import {
    type CosmosDBRecordIdentifier,
    DEFAULT_EXECUTION_TIMEOUT,
    DEFAULT_PAGE_SIZE,
    type ResultViewMetadata,
    type SerializedQueryResult,
} from '../../../../cosmosdb/types/queryResult';
import { type Channel } from '../../../../panels/Communication/Channel/Channel';
import { BaseContextProvider } from '../../../utils/context/BaseContextProvider';
import { type OpenDocumentMode } from '../../Document/state/DocumentState';
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
        await this.sendCommand('updateQueryHistory', query);
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

    public async openDocument(mode: OpenDocumentMode, document?: CosmosDBRecordIdentifier): Promise<void> {
        await this.sendCommand('openDocument', mode, document);
    }
    public async openDocuments(mode: OpenDocumentMode, documents: CosmosDBRecordIdentifier[]): Promise<void> {
        for (const document of documents) {
            await this.openDocument(mode, document);
        }
    }
    public async deleteDocument(document: CosmosDBRecordIdentifier): Promise<void> {
        await this.sendCommand('deleteDocument', document);
    }
    public async deleteDocuments(documents: CosmosDBRecordIdentifier[]): Promise<void> {
        for (const document of documents) {
            await this.deleteDocument(document);
        }
    }
    public async provideFeedback(): Promise<void> {
        await this.sendCommand('provideFeedback');
    }

    public async saveCSV(
        name: string,
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        await this.sendCommand('saveCSV', name, currentQueryResult, partitionKey, selection);
    }

    public async saveMetricsCSV(name: string, currentQueryResult: SerializedQueryResult | null): Promise<void> {
        await this.sendCommand('saveMetricsCSV', name, currentQueryResult);
    }

    public async copyCSVToClipboard(
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        await this.sendCommand('copyCSVToClipboard', currentQueryResult, partitionKey, selection);
    }

    public async copyMetricsCSVToClipboard(currentQueryResult: SerializedQueryResult | null): Promise<void> {
        await this.sendCommand('copyMetricsCSVToClipboard', currentQueryResult);
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

        this.channel.on('isSurveyCandidateChanged', (isSurveyCandidate: boolean) => {
            this.dispatch({ type: 'setIsSurveyCandidate', isSurveyCandidate: isSurveyCandidate });
        });

        this.channel.on('updateQueryHistory', (queryHistory: string[]) => {
            this.dispatch({ type: 'updateHistory', queryHistory });
        });

        //TODO: there should be no queryError event that needs to show a toast,
        //      all errors should be handled by QuerySession and dispatched to host error handling.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        this.channel.on('queryError', (_executionId: string, _error: string) => {
            //this.showToast('Query error', error, 'error');
        });
    }
}
