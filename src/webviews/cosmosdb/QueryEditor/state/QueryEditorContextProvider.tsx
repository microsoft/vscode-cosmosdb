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

/**
 * Shape returned by query execution mutations (runQuery, nextPage, prevPage, firstPage).
 * Declared here to avoid TS2589 from deep tRPC type inference.
 */
type QueryExecutionResponse = {
    executionId: string;
    startTime: number;
    endTime: number;
    result: SerializedQueryResult | null;
    currentPage: number;
    error?: string;
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
        const historyResult = await this.trpcClient.queryEditor.updateQueryHistory.mutate({ query });
        if (historyResult?.queryHistory) {
            this.dispatch({ type: 'updateHistory', queryHistory: historyResult.queryHistory });
        }
        // tRPC output type matches QueryExecutionResponse; explicit cast avoids TS2589
        // from deep AppRouter type inference.
        const result = (await this.trpcClient.queryEditor.runQuery.mutate({
            query,
            options: { ...DEFAULT_RESULT_VIEW_METADATA, ...options },
        })) as QueryExecutionResponse | undefined;
        this.handleQueryExecutionResult(result);
    }
    public async stopQuery(executionId: string): Promise<void> {
        const result = await this.trpcClient.queryEditor.stopQuery.mutate({ executionId });
        if (result) {
            this.dispatch({
                type: 'executionStopped',
                executionId: result.executionId,
                endExecutionTime: result.endTime,
            });
        }
    }
    public async nextPage(executionId: string): Promise<void> {
        const result = (await this.trpcClient.queryEditor.nextPage.mutate({ executionId })) as
            | QueryExecutionResponse
            | undefined;
        this.handleQueryExecutionResult(result);
    }
    public async prevPage(executionId: string): Promise<void> {
        const result = (await this.trpcClient.queryEditor.prevPage.mutate({ executionId })) as
            | QueryExecutionResponse
            | undefined;
        this.handleQueryExecutionResult(result);
    }
    public async firstPage(executionId: string): Promise<void> {
        const result = (await this.trpcClient.queryEditor.firstPage.mutate({ executionId })) as
            | QueryExecutionResponse
            | undefined;
        this.handleQueryExecutionResult(result);
    }

    public async openFile(): Promise<void> {
        const result = await this.trpcClient.queryEditor.openFile.mutate();
        if (result?.query) {
            this.insertText(result.query);
        }
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
        const result = await this.trpcClient.queryEditor.connectToDatabase.mutate();
        if (result) {
            this.dispatch({
                type: 'databaseConnected',
                dbName: result.dbName,
                containerName: result.containerName,
                partitionKey: result.partitionKey as PartitionKeyDefinition | undefined,
            });
        }
    }
    public async disconnectFromDatabase(): Promise<void> {
        await this.trpcClient.queryEditor.disconnectFromDatabase.mutate();
        this.dispatch({ type: 'databaseDisconnected' });
    }
    public async getConnections(): Promise<void> {
        const result = await this.trpcClient.queryEditor.getConnections.query();
        if (result && 'connectionList' in result) {
            this.dispatch({ type: 'setConnectionList', connectionList: result.connectionList });
        }
    }
    public async setConnection(databaseId: string, containerId: string): Promise<void> {
        const result = await this.trpcClient.queryEditor.setConnection.mutate({ databaseId, containerId });
        if (result) {
            this.dispatch({
                type: 'databaseConnected',
                dbName: result.dbName,
                containerName: result.containerName,
                partitionKey: result.partitionKey as PartitionKeyDefinition | undefined,
            });
        }
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
        await this.trpcClient.queryEditor.openDocument.mutate({ mode, documentId: document });
    }
    public async openDocuments(mode: OpenDocumentMode, documents: CosmosDBRecordIdentifier[]): Promise<void> {
        for (const document of documents) {
            await this.openDocument(mode, document);
        }
    }
    public async deleteDocument(document: CosmosDBRecordIdentifier): Promise<void> {
        await this.trpcClient.queryEditor.deleteDocument.mutate({ documentId: document });
    }
    public async deleteDocuments(documents: CosmosDBRecordIdentifier[]): Promise<void> {
        await this.trpcClient.queryEditor.deleteDocuments.mutate({ documentIds: documents });
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
            result: currentQueryResult,
            partitionKey: partitionKey,
            selection,
        });
    }

    public async saveMetricsCSV(name: string, currentQueryResult: SerializedQueryResult | null): Promise<void> {
        await this.trpcClient.queryEditor.saveMetricsCSV.mutate({
            name,
            result: currentQueryResult,
        });
    }

    public async copyCSVToClipboard(
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        await this.trpcClient.queryEditor.copyCSVToClipboard.mutate({
            result: currentQueryResult,
            partitionKey: partitionKey,
            selection,
        });
    }

    public async copyMetricsCSVToClipboard(currentQueryResult: SerializedQueryResult | null): Promise<void> {
        await this.trpcClient.queryEditor.copyMetricsCSVToClipboard.mutate({
            result: currentQueryResult,
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
        void this.trpcClient.queryEditor.init.mutate().then((result) => {
            if (!result) return;

            if (result.connectionState) {
                this.dispatch({
                    type: 'databaseConnected',
                    dbName: result.connectionState.dbName,
                    containerName: result.connectionState.containerName,
                    partitionKey: result.connectionState.partitionKey as PartitionKeyDefinition | undefined,
                });
            } else {
                this.dispatch({ type: 'databaseDisconnected' });
            }

            if (result.queryHistory.length > 0) {
                this.dispatch({ type: 'updateHistory', queryHistory: result.queryHistory });
            }

            if (result.throughputBuckets) {
                this.dispatch({ type: 'updateThroughputBuckets', throughputBuckets: result.throughputBuckets });
            }

            if (result.initialQuery) {
                this.insertText(result.initialQuery);
            }

            this.dispatch({ type: 'setIsSurveyCandidate', isSurveyCandidate: result.isSurveyCandidate });
            this.dispatch({ type: 'setAIFeaturesEnabled', isAIFeaturesEnabled: result.isAIFeaturesEnabled });
        });
    }

    protected initEventListeners() {
        this.eventSubscription = this.trpcClient.queryEditor.events.subscribe(undefined, {
            onData: (event) => {
                this.handleQueryEditorEvent(event as QueryEditorEvent);
            },
        });
    }

    private handleQueryEditorEvent(event: QueryEditorEvent): void {
        switch (event.type) {
            case 'confirmToolInvocation':
                // Handled by GenerateQueryInput component-level subscriber
                break;
            case 'aiFeaturesEnabledChanged':
                this.dispatch({ type: 'setAIFeaturesEnabled', isAIFeaturesEnabled: event.isEnabled });
                break;
            case 'queryTextPushed':
                this.insertText(event.query);
                break;
            case 'isSurveyCandidateChanged':
                this.dispatch({ type: 'setIsSurveyCandidate', isSurveyCandidate: event.isSurveyCandidate });
                break;
        }
    }

    private handleQueryExecutionResult(result?: QueryExecutionResponse): void {
        if (!result) return;

        this.dispatch({
            type: 'executionStarted',
            executionId: result.executionId,
            startExecutionTime: result.startTime,
        });

        if (result.result) {
            this.dispatch({
                type: 'updateQueryResult',
                executionId: result.executionId,
                result: result.result,
                currentPage: result.currentPage,
            });
        }

        this.dispatch({
            type: 'executionStopped',
            executionId: result.executionId,
            endExecutionTime: result.endTime,
        });
    }
}
