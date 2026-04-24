/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { type TRPCClient } from '@trpc/client';
import * as l10n from '@vscode/l10n';
import {
    type CosmosDBRecordIdentifier,
    DEFAULT_EXECUTION_TIMEOUT,
    DEFAULT_PAGE_SIZE,
    type QueryMetadata,
    type SerializedQueryResult,
} from '../../../../cosmosdb/types/queryResult';
import { type JSONSchema } from '../../../../utils/json/JSONSchema';
import { type QueryEditorAppRouter, type QueryEditorEvent } from '../../../api/types';
import { BaseContextProvider, type DispatchToastFn } from '../../../utils/context/BaseContextProvider';
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

export class QueryEditorContextProvider extends BaseContextProvider<QueryEditorAppRouter> {
    private eventSubscription?: { unsubscribe: () => void };

    constructor(
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: DispatchToastFn,
        trpcClient: TRPCClient<QueryEditorAppRouter>,
    ) {
        super(dispatchToast, trpcClient);
    }

    public async runQuery(query: string, options: QueryMetadata): Promise<void> {
        // Update history
        const historyResult = await this.safeMutate(() =>
            this.trpcClient.queryEditor.updateQueryHistory.mutate({ query }),
        );
        if (historyResult?.queryHistory) {
            this.dispatch({ type: 'updateHistory', queryHistory: historyResult.queryHistory });
        }

        // Step 1: Create the session — this returns the executionId immediately
        const session = await this.safeMutate(() =>
            this.trpcClient.queryEditor.createQuerySession.mutate({
                query,
                options: { ...DEFAULT_RESULT_VIEW_METADATA, ...options },
            }),
        );

        if (!session?.executionId) {
            // User cancelled the confirmation dialog, no connection, or error
            return;
        }

        // Step 2: Show executing state with the real executionId (enables Cancel)
        this.dispatch({
            type: 'executionStarted',
            executionId: session.executionId,
            startExecutionTime: Date.now(),
        });

        // Step 3: Fire the actual query execution without blocking the UI
        void (
            this.trpcClient.queryEditor.runQuery.mutate({
                executionId: session.executionId,
            }) as Promise<QueryExecutionResponse | undefined>
        )
            .then((result) => this.handleQueryExecutionResult(result))
            .catch((error: unknown) => this.handleQueryExecutionError(error));
    }
    public async stopQuery(executionId: string): Promise<void> {
        const result = await this.safeMutate(() => this.trpcClient.queryEditor.stopQuery.mutate({ executionId }));
        if (result) {
            this.dispatch({
                type: 'executionStopped',
                executionId: result.executionId,
                endExecutionTime: result.endTime,
            });
        } else {
            // No server-side session found (e.g., cancel was pressed before the query started).
            // Stop the executing state locally.
            this.dispatch({
                type: 'executionStopped',
                executionId: '',
                endExecutionTime: Date.now(),
            });
        }
    }
    public nextPage(executionId: string): void {
        this.dispatch({ type: 'paginationStarted', startExecutionTime: Date.now() });

        void (
            this.trpcClient.queryEditor.nextPage.mutate({ executionId }) as Promise<QueryExecutionResponse | undefined>
        )
            .then((result) => this.handleQueryExecutionResult(result))
            .catch((error: unknown) => this.handleQueryExecutionError(error));
    }
    public prevPage(executionId: string): void {
        this.dispatch({ type: 'paginationStarted', startExecutionTime: Date.now() });

        void (
            this.trpcClient.queryEditor.prevPage.mutate({ executionId }) as Promise<QueryExecutionResponse | undefined>
        )
            .then((result) => this.handleQueryExecutionResult(result))
            .catch((error: unknown) => this.handleQueryExecutionError(error));
    }
    public firstPage(executionId: string): void {
        this.dispatch({ type: 'paginationStarted', startExecutionTime: Date.now() });

        void (
            this.trpcClient.queryEditor.firstPage.mutate({ executionId }) as Promise<QueryExecutionResponse | undefined>
        )
            .then((result) => this.handleQueryExecutionResult(result))
            .catch((error: unknown) => this.handleQueryExecutionError(error));
    }

    public async openFile(): Promise<void> {
        const result = await this.safeMutate(() => this.trpcClient.queryEditor.openFile.mutate());
        if (result?.query) {
            await this.insertText(result.query);
        }
    }
    public async copyToClipboard(text: string): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.copyToClipboard.mutate({ text }));
    }
    public async saveToFile(text: string, filename: string, ext: string): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.saveFile.mutate({ text, filename, ext }));
    }
    public async duplicateTab(text: string): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.duplicateTab.mutate({ text }));
    }
    public async insertText(query: string): Promise<void> {
        this.dispatch({ type: 'insertText', queryValue: query ?? '' });
        await this.safeMutate(() => this.trpcClient.queryEditor.updateQueryText.mutate({ query }));
    }
    public setSelectedText(query: string): void {
        this.dispatch({ type: 'setQuerySelectedValue', selectedValue: query });
    }

    public async connectToDatabase(): Promise<void> {
        const result = await this.safeMutate(() => this.trpcClient.queryEditor.connectToDatabase.mutate());
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
        await this.safeMutate(() => this.trpcClient.queryEditor.disconnectFromDatabase.mutate());
        this.dispatch({ type: 'databaseDisconnected' });
    }
    public async getConnections(): Promise<void> {
        const result = await this.safeMutate(() => this.trpcClient.queryEditor.getConnections.query());
        if (result && 'connectionList' in result) {
            this.dispatch({ type: 'setConnectionList', connectionList: result.connectionList });
        }
    }
    public async setConnection(databaseId: string, containerId: string): Promise<void> {
        const result = await this.safeMutate(() =>
            this.trpcClient.queryEditor.setConnection.mutate({ databaseId, containerId }),
        );
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
        await this.safeMutate(() => this.trpcClient.queryEditor.openDocument.mutate({ mode, documentId: document }));
    }
    public async openDocuments(mode: OpenDocumentMode, documents: CosmosDBRecordIdentifier[]): Promise<void> {
        for (const document of documents) {
            await this.openDocument(mode, document);
        }
    }
    public async deleteDocument(document: CosmosDBRecordIdentifier): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.deleteDocument.mutate({ documentId: document }));
    }
    public async deleteDocuments(documents: CosmosDBRecordIdentifier[]): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.deleteDocuments.mutate({ documentIds: documents }));
    }
    public async provideFeedback(): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.provideFeedback.mutate());
    }

    public async generateSchema(limit?: number): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.generateSchema.mutate({ limit }));
    }

    public async openSchemaSettings(): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.openSchemaSettings.mutate());
    }

    public async showCurrentSchema(): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.showCurrentSchema.mutate());
    }

    public async deleteCurrentSchema(): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.deleteCurrentSchema.mutate());
    }

    public async saveCSV(
        name: string,
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        await this.safeMutate(() =>
            this.trpcClient.queryEditor.saveCSV.mutate({
                name,
                result: currentQueryResult,
                partitionKey: partitionKey,
                selection,
            }),
        );
    }

    public async saveMetricsCSV(name: string, currentQueryResult: SerializedQueryResult | null): Promise<void> {
        await this.safeMutate(() =>
            this.trpcClient.queryEditor.saveMetricsCSV.mutate({
                name,
                result: currentQueryResult,
            }),
        );
    }

    public async copyCSVToClipboard(
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        await this.safeMutate(() =>
            this.trpcClient.queryEditor.copyCSVToClipboard.mutate({
                result: currentQueryResult,
                partitionKey: partitionKey,
                selection,
            }),
        );
    }

    public async copyMetricsCSVToClipboard(currentQueryResult: SerializedQueryResult | null): Promise<void> {
        await this.safeMutate(() =>
            this.trpcClient.queryEditor.copyMetricsCSVToClipboard.mutate({
                result: currentQueryResult,
            }),
        );
    }

    public selectBucket(throughputBucket?: number): void {
        this.dispatch({ type: 'selectBucket', throughputBucket });
    }

    public async openCopilotExplainQuery(): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.openCopilotExplainQuery.mutate());
    }

    public async closeGenerateInput(): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.closeGenerateInput.mutate());
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
                void this.insertText(result.initialQuery);
            }

            this.dispatch({ type: 'setIsSurveyCandidate', isSurveyCandidate: result.isSurveyCandidate });
            this.dispatch({ type: 'setAIFeaturesEnabled', isAIFeaturesEnabled: result.isAIFeaturesEnabled ?? false });
            this.dispatch({
                type: 'setSchemaBasedOnQueries',
                isSchemaBasedOnQueries: result.isSchemaBasedOnQueries,
            });
            if (result.containerSchema !== undefined) {
                this.dispatch({
                    type: 'setContainerSchema',
                    containerSchema: result.containerSchema as JSONSchema | null,
                });
            }
        });
    }

    protected initEventListeners() {
        this.eventSubscription = this.trpcClient.queryEditor.events.subscribe(undefined, {
            onData: (event) => {
                this.handleQueryEditorEvent(event);
            },
        });
    }

    private handleQueryEditorEvent(event: QueryEditorEvent): void {
        switch (event.type) {
            case 'confirmToolInvocation':
                this.dispatch({ type: 'setConfirmToolInvocationMessage', message: event.message });
                break;
            case 'aiFeaturesEnabledChanged':
                this.dispatch({ type: 'setAIFeaturesEnabled', isAIFeaturesEnabled: event.isEnabled });
                break;
            case 'queryTextPushed':
                void this.insertText(event.query);
                break;
            case 'isSurveyCandidateChanged':
                this.dispatch({ type: 'setIsSurveyCandidate', isSurveyCandidate: event.isSurveyCandidate });
                break;
            case 'schemaSettingChanged':
                this.dispatch({
                    type: 'setSchemaBasedOnQueries',
                    isSchemaBasedOnQueries: event.isSchemaBasedOnQueries,
                });
                break;
            case 'schemaUpdated':
                this.dispatch({
                    type: 'setContainerSchema',
                    containerSchema: event.containerSchema as JSONSchema | null,
                });
                break;
        }
    }

    private handleQueryExecutionResult(result?: QueryExecutionResponse): void {
        if (!result) return;

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

    private handleQueryExecutionError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.showToast(l10n.t('Query Error'), message, 'error');

        // Stop the executing state; use currentExecutionId or empty string
        this.dispatch({
            type: 'executionStopped',
            executionId: '',
            endExecutionTime: Date.now(),
        });
    }
}
