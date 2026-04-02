/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import {
    type CosmosDBRecordIdentifier,
    DEFAULT_EXECUTION_TIMEOUT,
    DEFAULT_PAGE_SIZE,
    type QueryMetadata,
    type SerializedQueryResult,
} from '../../../../cosmosdb/types/queryResult';
import { type QueryEditorEvent } from '../../../api/configuration/routers/queryEditorEventsRouter';
import { BaseContextProvider, type DispatchToastFn, type TrpcClient } from '../../../utils/context/BaseContextProvider';
import { type OpenDocumentMode } from '../../Document/state/DocumentState';
import { type DispatchAction, type TableViewMode } from './QueryEditorState';

const DEFAULT_RESULT_VIEW_METADATA: QueryMetadata = {
    countPerPage: DEFAULT_PAGE_SIZE,
    timeout: DEFAULT_EXECUTION_TIMEOUT,
};

export class QueryEditorContextProvider extends BaseContextProvider {
    private eventSubscription?: { unsubscribe: () => void };
    declare protected readonly trpcClient: TrpcClient;

    constructor(
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: DispatchToastFn,
        trpcClient: TrpcClient,
    ) {
        super(dispatchToast, trpcClient);
    }

    public async runQuery(query: string, options: QueryMetadata): Promise<void> {
        await this.trpcClient.queryEditor.updateQueryHistory.mutate({ query });
        await this.trpcClient.queryEditor.runQuery.mutate({
            query,
            options: { ...DEFAULT_RESULT_VIEW_METADATA, ...options },
        });
    }
    public async stopQuery(executionId: string): Promise<void> {
        await this.trpcClient.queryEditor.stopQuery.mutate({ executionId });
    }
    public async nextPage(executionId: string): Promise<void> {
        await this.trpcClient.queryEditor.nextPage.mutate({ executionId });
    }
    public async prevPage(executionId: string): Promise<void> {
        await this.trpcClient.queryEditor.prevPage.mutate({ executionId });
    }
    public async firstPage(executionId: string): Promise<void> {
        await this.trpcClient.queryEditor.firstPage.mutate({ executionId });
    }

    public async openFile(): Promise<void> {
        await this.trpcClient.queryEditor.openFile.mutate();
    }
    public async copyToClipboard(text: string): Promise<void> {
        await this.trpcClient.queryEditor.copyToClipboard.mutate({ text });
    }
    public async saveToFile(text: string, filename: string, ext: string): Promise<void> {
        await this.trpcClient.queryEditor.saveFile.mutate({ text, filename, ext });
    }
    public async duplicateTab(text: string): Promise<void> {
        await this.trpcClient.queryEditor.duplicateTab.mutate({ text });
    }
    public insertText(query: string): void {
        this.dispatch({ type: 'insertText', queryValue: query ?? '' });
        void this.trpcClient.queryEditor.updateQueryText.mutate({ query });
    }
    public setSelectedText(query: string): void {
        this.dispatch({ type: 'setQuerySelectedValue', selectedValue: query });
    }

    public async connectToDatabase(): Promise<void> {
        await this.trpcClient.queryEditor.connectToDatabase.mutate();
    }
    public async disconnectFromDatabase(): Promise<void> {
        await this.trpcClient.queryEditor.disconnectFromDatabase.mutate();
    }
    public async getConnections(): Promise<void> {
        await this.trpcClient.queryEditor.getConnections.query();
    }
    public async setConnection(databaseId: string, containerId: string): Promise<void> {
        await this.trpcClient.queryEditor.setConnection.mutate({ databaseId, containerId });
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
        await this.trpcClient.queryEditor.openDocument.mutate({ mode, documentId: document as never });
    }
    public async openDocuments(mode: OpenDocumentMode, documents: CosmosDBRecordIdentifier[]): Promise<void> {
        for (const document of documents) {
            await this.openDocument(mode, document);
        }
    }
    public async deleteDocument(document: CosmosDBRecordIdentifier): Promise<void> {
        await this.trpcClient.queryEditor.deleteDocument.mutate({ documentId: document as never });
    }
    public async deleteDocuments(documents: CosmosDBRecordIdentifier[]): Promise<void> {
        await this.trpcClient.queryEditor.deleteDocuments.mutate({ documentIds: documents as never });
    }
    public async provideFeedback(): Promise<void> {
        await this.trpcClient.queryEditor.provideFeedback.mutate();
    }

    public async saveCSV(
        name: string,
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        await this.trpcClient.queryEditor.saveCSV.mutate({
            name,
            result: currentQueryResult as never,
            partitionKey: partitionKey as never,
            selection,
        });
    }

    public async saveMetricsCSV(name: string, currentQueryResult: SerializedQueryResult | null): Promise<void> {
        await this.trpcClient.queryEditor.saveMetricsCSV.mutate({
            name,
            result: currentQueryResult as never,
        });
    }

    public async copyCSVToClipboard(
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        await this.trpcClient.queryEditor.copyCSVToClipboard.mutate({
            result: currentQueryResult as never,
            partitionKey: partitionKey as never,
            selection,
        });
    }

    public async copyMetricsCSVToClipboard(currentQueryResult: SerializedQueryResult | null): Promise<void> {
        await this.trpcClient.queryEditor.copyMetricsCSVToClipboard.mutate({
            result: currentQueryResult as never,
        });
    }

    public selectBucket(throughputBucket?: number): void {
        this.dispatch({ type: 'selectBucket', throughputBucket });
    }

    public async openCopilotExplainQuery(): Promise<void> {
        await this.trpcClient.queryEditor.openCopilotExplainQuery.mutate();
    }

    public async closeGenerateInput(): Promise<void> {
        await this.trpcClient.queryEditor.closeGenerateInput.mutate();
    }

    public dispose() {
        this.eventSubscription?.unsubscribe();
        super.dispose();
    }

    protected init(): void {
        // Call tRPC init instead of sending legacy 'ready' channel event
        void this.trpcClient.queryEditor.init.mutate();
    }

    protected initEventListeners() {
        this.eventSubscription = this.trpcClient.queryEditor.events.subscribe(undefined, {
            onData: (event: QueryEditorEvent) => {
                this.handleQueryEditorEvent(event);
            },
        });
    }

    private handleQueryEditorEvent(event: QueryEditorEvent): void {
        switch (event.type) {
            case 'fileOpened':
                this.insertText(event.query);
                break;
            case 'databaseConnected':
                this.dispatch({
                    type: 'databaseConnected',
                    dbName: event.dbName,
                    containerName: event.containerName,
                    partitionKey: event.partitionKey as PartitionKeyDefinition | undefined,
                });
                break;
            case 'databaseDisconnected':
                this.dispatch({ type: 'databaseDisconnected' });
                break;
            case 'setConnectionList':
                this.dispatch({ type: 'setConnectionList', connectionList: event.connectionList });
                break;
            case 'executionStarted':
                this.dispatch({
                    type: 'executionStarted',
                    executionId: event.executionId,
                    startExecutionTime: event.startTime,
                });
                break;
            case 'executionStopped':
                this.dispatch({
                    type: 'executionStopped',
                    executionId: event.executionId,
                    endExecutionTime: event.endTime,
                });
                break;
            case 'queryResults':
                this.dispatch({
                    type: 'updateQueryResult',
                    executionId: event.executionId,
                    result: event.result as SerializedQueryResult,
                    currentPage: event.currentPage,
                });
                break;
            case 'queryError':
                // Errors handled by QuerySession
                break;
            case 'isSurveyCandidateChanged':
                this.dispatch({ type: 'setIsSurveyCandidate', isSurveyCandidate: event.isSurveyCandidate });
                break;
            case 'updateQueryHistory':
                this.dispatch({ type: 'updateHistory', queryHistory: event.queryHistory });
                break;
            case 'updateThroughputBuckets':
                this.dispatch({ type: 'updateThroughputBuckets', throughputBuckets: event.throughputBuckets });
                break;
            case 'queryGenerated':
                if (typeof event.generatedQuery === 'string') {
                    this.insertText(event.generatedQuery);
                }
                break;
            case 'aiFeaturesEnabledChanged':
                this.dispatch({ type: 'setAIFeaturesEnabled', isAIFeaturesEnabled: event.isEnabled });
                break;
            case 'confirmToolInvocation':
            case 'selectedModelName':
            case 'availableModels':
            case 'documentDeleted':
            case 'bulkDeleteComplete':
                // These events are handled directly by component-level subscribers (e.g., GenerateQueryInput)
                break;
        }
    }
}
