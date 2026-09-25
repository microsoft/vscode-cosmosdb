/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition, type PriorityLevel } from '@azure/cosmos';
import { type JSONSchema } from '@azure/cosmosdb-schema-analyzer';
import { type TrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import {
    type CosmosDBRecordIdentifier,
    DEFAULT_EXECUTION_TIMEOUT,
    DEFAULT_PAGE_SIZE,
    type QueryMetadata,
    type SerializedQueryResult,
} from '../../../../cosmosdb/types/queryResult';
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
    private connectionVersion = 0;
    private isChangingConnection = false;
    declare private initialization: Promise<void>;

    constructor(
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: DispatchToastFn,
        trpcClient: TrpcClient<QueryEditorAppRouter>,
    ) {
        super(dispatchToast, trpcClient);
    }

    public async runQuery(query: string, options: QueryMetadata): Promise<void> {
        await this.initialization;
        if (this.isChangingConnection) return;
        const connectionVersion = this.connectionVersion;
        // Validate and clean the query — may show confirmation dialogs for ambiguous
        // or syntactically invalid queries. Returns undefined when user cancels.
        const prepared = await this.safeMutate(() => this.trpcClient.queryEditor.prepareQuery.mutate({ query }));
        if (!prepared?.cleanQuery) return;
        const cleanQuery = prepared.cleanQuery;

        // Update history with the clean query
        const historyResult = await this.safeMutate(() =>
            this.trpcClient.queryEditor.updateQueryHistory.mutate({ query: cleanQuery, connectionVersion }),
        );
        if (historyResult?.queryHistory && connectionVersion === this.connectionVersion) {
            this.dispatch({ type: 'updateHistory', queryHistory: historyResult.queryHistory });
        }

        // Step 1: Create the session — this returns the executionId immediately
        const session = await this.safeMutate(() =>
            this.trpcClient.queryEditor.createQuerySession.mutate({
                query: cleanQuery,
                connectionVersion,
                options: { ...DEFAULT_RESULT_VIEW_METADATA, ...options },
            }),
        );

        if (!session?.executionId) {
            // User canceled the confirmation dialog, no connection, or error
            return;
        }
        if (connectionVersion !== this.connectionVersion) return;

        // Step 2: Show executing state with the real executionId (enables Cancel)
        this.dispatch({
            type: 'executionStarted',
            executionId: session.executionId,
            startExecutionTime: Date.now(),
        });

        // Step 3: Fire the actual query execution without blocking the UI
        (
            this.trpcClient.queryEditor.runQuery.mutate({
                executionId: session.executionId,
            }) as Promise<QueryExecutionResponse | undefined>
        )
            .then((result) => this.handleQueryExecutionResult(result))
            .catch((error: unknown) => this.handleQueryExecutionError(error, session.executionId));
    }

    /**
     * Runs `query` in the editor on behalf of the `cosmosdb_executeCurrentQuery` tool. Mirrors the normal
     * run flow so results render in the grid, then signals the extension (`reportActiveQueryExecuted`)
     * so the awaiting tool can read PII-free result metadata. Awaits execution so the signal fires
     * only after the result is available. `requestId` correlates this run with the exact invocation that
     * requested it, so concurrent tool calls never resolve against each other's results.
     */
    private async runActiveQueryFromTool(
        query: string,
        requestId: string,
        connection: { endpoint: string; databaseId: string; containerId: string },
    ): Promise<void> {
        // The executionId of the run we actually start. It stays undefined when the run is cancelled
        // or never starts (e.g. prepareQuery is cancelled, or createQuerySession fails), so the
        // awaiting tool can tell "ran" from "did not run" and never reads stale results from a
        // previous session.
        let executedId: string | undefined;
        try {
            await this.initialization;
            const connectionVersion = this.connectionVersion;
            if (this.isChangingConnection) return;
            const prepared = await this.safeMutate(() => this.trpcClient.queryEditor.prepareQuery.mutate({ query }));
            if (!prepared?.cleanQuery) return;
            const cleanQuery = prepared.cleanQuery;

            const session = await this.safeMutate(() =>
                this.trpcClient.queryEditor.createQuerySession.mutate({
                    query: cleanQuery,
                    connectionVersion,
                    options: { ...DEFAULT_RESULT_VIEW_METADATA },
                    expectedConnection: connection,
                    preserveExistingSessions: true,
                    isLlmTool: true,
                }),
            );
            if (!session?.executionId || connectionVersion !== this.connectionVersion) return;
            const shouldExecute = await this.safeMutate(() =>
                this.trpcClient.queryEditor.reportActiveQueryStarted.mutate({
                    executionId: session.executionId,
                    requestId,
                }),
            );
            if (!shouldExecute || connectionVersion !== this.connectionVersion) return;

            executedId = session.executionId;
            this.dispatch({
                type: 'executionStarted',
                executionId: session.executionId,
                startExecutionTime: Date.now(),
            });

            try {
                const result = (await this.trpcClient.queryEditor.runQuery.mutate({
                    executionId: session.executionId,
                })) as QueryExecutionResponse | undefined;
                this.handleQueryExecutionResult(result);
            } catch (error: unknown) {
                this.handleQueryExecutionError(error, session.executionId);
            }
        } finally {
            // Signal completion to the tool, passing the executionId only when a run was actually
            // started so the tool reads results for exactly this run (or none).
            void this.safeMutate(() =>
                this.trpcClient.queryEditor.reportActiveQueryExecuted.mutate({ executionId: executedId, requestId }),
            );
        }
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
                executionId,
                endExecutionTime: Date.now(),
            });
        }
    }
    public nextPage(executionId: string): void {
        this.dispatch({ type: 'paginationStarted', startExecutionTime: Date.now() });

        (this.trpcClient.queryEditor.nextPage.mutate({ executionId }) as Promise<QueryExecutionResponse | undefined>)
            .then((result) => this.handleQueryExecutionResult(result))
            .catch((error: unknown) => this.handleQueryExecutionError(error, executionId));
    }
    public prevPage(executionId: string): void {
        this.dispatch({ type: 'paginationStarted', startExecutionTime: Date.now() });

        (this.trpcClient.queryEditor.prevPage.mutate({ executionId }) as Promise<QueryExecutionResponse | undefined>)
            .then((result) => this.handleQueryExecutionResult(result))
            .catch((error: unknown) => this.handleQueryExecutionError(error, executionId));
    }
    public firstPage(executionId: string): void {
        this.dispatch({ type: 'paginationStarted', startExecutionTime: Date.now() });

        (this.trpcClient.queryEditor.firstPage.mutate({ executionId }) as Promise<QueryExecutionResponse | undefined>)
            .then((result) => this.handleQueryExecutionResult(result))
            .catch((error: unknown) => this.handleQueryExecutionError(error, executionId));
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
        void this.safeMutate(() => this.trpcClient.queryEditor.updateSelectedText.mutate({ selectedQuery: query }));
    }
    public setCurrentQueryBlock(queryBlock: string): void {
        this.dispatch({ type: 'setCurrentQueryBlock', currentQueryBlock: queryBlock });
    }

    public async connectToDatabase(): Promise<void> {
        await this.changeConnection(() => this.trpcClient.queryEditor.connectToDatabase.mutate());
    }
    public async disconnectFromDatabase(): Promise<void> {
        await this.changeConnection(async () => {
            const result = await this.trpcClient.queryEditor.disconnectFromDatabase.mutate();
            this.connectionVersion = result.connectionVersion;
            this.dispatch({ type: 'databaseDisconnected' });
            return undefined;
        });
    }
    public async getConnections(): Promise<void> {
        const connectionVersion = this.connectionVersion;
        const result = await this.safeMutate(() => this.trpcClient.queryEditor.getConnections.query());
        if (connectionVersion !== this.connectionVersion) return;
        // Always dispatch a list — on failure use an empty map so the dropdown
        // resolves out of the "Loading…" state. The errorLink middleware shows
        // the actual error as a toast.
        this.dispatch({
            type: 'setConnectionList',
            connectionList: result && 'connectionList' in result ? result.connectionList : {},
        });
    }
    public async setConnection(databaseId: string, containerId: string): Promise<void> {
        await this.changeConnection(() =>
            this.trpcClient.queryEditor.setConnection.mutate({ databaseId, containerId }),
        );
    }

    private async changeConnection(
        change: () => Promise<
            | {
                  connectionVersion: number;
                  dbName: string;
                  containerName: string;
                  partitionKey?: PartitionKeyDefinition;
                  queryHistory?: string[];
                  containerSchema?: Record<string, unknown> | null;
                  throughputBuckets?: boolean[];
              }
            | undefined
        >,
    ): Promise<void> {
        if (this.isChangingConnection) return;
        this.isChangingConnection = true;
        this.dispatch({ type: 'connectionChangeStarted' });
        try {
            await this.initialization;
            const result = await this.safeMutate(change);
            if (result) {
                this.connectionVersion = result.connectionVersion;
                this.dispatch({ type: 'databaseConnected', ...result });
                this.dispatch({ type: 'updateHistory', queryHistory: result.queryHistory ?? [] });
                this.dispatch({
                    type: 'setContainerSchema',
                    containerSchema: (result.containerSchema as JSONSchema | null) ?? null,
                });
                this.dispatch({ type: 'updateThroughputBuckets', throughputBuckets: result.throughputBuckets });
            }
        } finally {
            this.isChangingConnection = false;
            this.dispatch({ type: 'connectionChangeFinished' });
        }
    }

    /**
     * Fetches connection-dependent capabilities used by the UI to decide which
     * run-options menus to expose.
     *
     * Returns `{ isEmulator, isPriorityLevelEnabled, currentPriorityLevel }`:
     * - `isEmulator` is true when the connection points at the local emulator.
     * - `isPriorityLevelEnabled` reflects whether the Cosmos DB account has
     *   priority-based execution enabled at the ARM resource level.
     * - `currentPriorityLevel` is the user's last persisted choice (validated
     *   against the enum, falling back to `Low` for first use or invalid
     *   entries). The UI seeds its picker with this value on panel open.
     */
    public async getCapabilities(): Promise<{
        isEmulator: boolean;
        isPriorityLevelEnabled: boolean;
        currentPriorityLevel: PriorityLevel;
    }> {
        return this.trpcClient.queryEditor.getCapabilities.mutate();
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

    public async openDocument(
        mode: OpenDocumentMode,
        document?: CosmosDBRecordIdentifier,
        executionId?: string,
    ): Promise<void> {
        await this.safeMutate(() =>
            this.trpcClient.queryEditor.openDocument.mutate({ mode, documentId: document, executionId }),
        );
    }
    public async openDocuments(
        mode: OpenDocumentMode,
        documents: CosmosDBRecordIdentifier[],
        executionId: string,
    ): Promise<void> {
        await Promise.all(documents.map((documentId) => this.openDocument(mode, documentId, executionId)));
    }
    public async deleteDocument(document: CosmosDBRecordIdentifier, executionId: string): Promise<void> {
        await this.safeMutate(() =>
            this.trpcClient.queryEditor.deleteDocument.mutate({ documentId: document, executionId }),
        );
    }
    public async deleteDocuments(documents: CosmosDBRecordIdentifier[], executionId: string): Promise<void> {
        await this.safeMutate(() =>
            this.trpcClient.queryEditor.deleteDocuments.mutate({ documentIds: documents, executionId }),
        );
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

    public setPriorityLevel(priorityLevel: PriorityLevel): void {
        this.dispatch({ type: 'setPriorityLevel', priorityLevel });
        // Persist on the extension side so the choice survives panel reopens.
        // Fire-and-forget: a transient persistence failure shouldn't block the
        // UI update — the local state already reflects the new value.
        void this.safeMutate(() => this.trpcClient.queryEditor.setPriorityLevel.mutate({ priorityLevel }));
    }

    public async generateQueryViaAgent(): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.generateQueryViaAgent.mutate());
    }

    public async explainQueryViaAgent(): Promise<void> {
        await this.safeMutate(() => this.trpcClient.queryEditor.explainQueryViaAgent.mutate());
    }

    public dispose() {
        this.eventSubscription?.unsubscribe();
        super.dispose();
    }

    protected init(): void {
        this.initialization = this.safeMutate(() => this.trpcClient.queryEditor.init.mutate()).then((result) => {
            if (!result) return;

            this.connectionVersion = result.connectionVersion;
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

            // Always dispatch — the server may explicitly return `undefined` to indicate
            // throughput buckets are unsupported (e.g. when connected to the Cosmos DB
            // Emulator). Without this, the default state ([true × 5]) would keep showing.
            this.dispatch({ type: 'updateThroughputBuckets', throughputBuckets: result.throughputBuckets });

            if (result.initialQuery) {
                void this.insertText(result.initialQuery);
            }
            this.dispatch({ type: 'setIsSurveyCandidate', isSurveyCandidate: result.isSurveyCandidate });
            this.dispatch({ type: 'setAIFeaturesEnabled', isAIFeaturesEnabled: result.isAIFeaturesEnabled });
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
                if (event.connectionVersion !== this.connectionVersion) break;
                this.dispatch({
                    type: 'setContainerSchema',
                    containerSchema: event.containerSchema as JSONSchema | null,
                });
                break;
            case 'throughputBucketsRefreshRequested':
                void this.refreshThroughputBuckets();
                break;
            case 'runActiveQueryRequested':
                void this.runActiveQueryFromTool(event.query, event.requestId, event.connection);
                break;
        }
    }

    private async refreshThroughputBuckets(): Promise<void> {
        const connectionVersion = this.connectionVersion;
        try {
            const throughputBuckets = await this.trpcClient.queryEditor.refreshThroughputBuckets.mutate();
            if (connectionVersion !== this.connectionVersion) return;
            this.dispatch({ type: 'updateThroughputBuckets', throughputBuckets });
        } catch {
            // Error notification is handled by the tRPC errorLink middleware. Keep the last known availability.
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

    private handleQueryExecutionError(error: unknown, executionId: string): void {
        const message = error instanceof Error ? error.message : String(error);
        this.showToast(l10n.t('Query Error'), message, 'error');

        this.dispatch({
            type: 'executionStopped',
            executionId,
            endExecutionTime: Date.now(),
        });
    }
}
