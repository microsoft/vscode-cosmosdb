/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getCosmosDBClientByConnection, getCosmosDBKeyCredential } from '../cosmosdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlCodeLensProvider';
import { DocumentSession } from '../cosmosdb/session/DocumentSession';
import { QuerySession } from '../cosmosdb/session/QuerySession';
import {
    type CosmosDBRecordIdentifier,
    type ResultViewMetadata,
    type SerializedQueryResult,
} from '../cosmosdb/types/queryResult';
import { getNoSqlQueryConnection } from '../cosmosdb/utils/NoSqlQueryConnection';
import { StorageNames, StorageService, type StorageItem } from '../services/storageService';
import { queryMetricsToCsv, queryResultToCsv } from '../utils/csvConverter';
import { getIsSurveyDisabledGlobally, openSurvey, promptAfterActionEventually } from '../utils/survey';
import { ExperienceKind, UsageImpact } from '../utils/surveyTypes';
import * as vscodeUtil from '../utils/vscodeUtils';
import { BaseTab, type CommandPayload } from './BaseTab';
import { DocumentTab } from './DocumentTab';

const QUERY_HISTORY_SIZE = 10;
const HISTORY_STORAGE_KEY = 'ms-azuretools.vscode-cosmosdb.history';

type HistoryItem = StorageItem & {
    properties: {
        history: string[];
    };
};

export class QueryEditorTab extends BaseTab {
    public static readonly title = 'Query Editor';
    public static readonly viewType = 'cosmosDbQuery';
    public static readonly openTabs: Set<QueryEditorTab> = new Set<QueryEditorTab>();

    private readonly sessions = new Map<string, QuerySession>();

    private connection: NoSqlQueryConnection | undefined;
    private query: string | undefined;

    protected constructor(panel: vscode.WebviewPanel, connection?: NoSqlQueryConnection, query?: string) {
        super(panel, QueryEditorTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        QueryEditorTab.openTabs.add(this);

        this.connection = connection;
        this.query = query;

        if (connection) {
            if (connection.credentials) {
                const masterKey = getCosmosDBKeyCredential(connection.credentials)?.key;
                if (masterKey) {
                    this.telemetryContext.addMaskedValue(masterKey);
                }
            }

            this.telemetryContext.addMaskedValue(connection.databaseId);
            this.telemetryContext.addMaskedValue(connection.containerId);
        }
    }

    public static render(
        connection?: NoSqlQueryConnection,
        viewColumn = vscode.ViewColumn.Active,
        revealTabIfExist = false,
        query?: string,
    ): QueryEditorTab {
        if (revealTabIfExist && connection) {
            const openTab = [...QueryEditorTab.openTabs].find(
                (openTab) =>
                    openTab.connection?.endpoint === connection.endpoint &&
                    openTab.connection?.databaseId === connection.databaseId &&
                    openTab.connection?.containerId === connection.containerId,
            );
            if (openTab) {
                openTab.panel.reveal(viewColumn);
                return openTab;
            }
        }

        const panel = vscode.window.createWebviewPanel(QueryEditorTab.viewType, QueryEditorTab.title, viewColumn, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new QueryEditorTab(panel, connection, query);
    }

    public dispose(): void {
        QueryEditorTab.openTabs.delete(this);

        this.sessions.forEach((session) => session.dispose());
        this.sessions.clear();

        super.dispose();
    }

    protected initController() {
        super.initController();

        this.channel.on<void>('ready', async () => {
            await this.updateConnection(this.connection);
            await this.updateQueryHistory();
            if (this.query) {
                await this.channel.postMessage({
                    type: 'event',
                    name: 'fileOpened',
                    params: [this.query],
                });
            }
            await this.channel.postMessage({
                type: 'event',
                name: 'isSurveyCandidateChanged',
                params: [!getIsSurveyDisabledGlobally()],
            });
        });
    }

    protected getCommand(payload: CommandPayload): Promise<void> {
        const commandName = payload.commandName;
        switch (commandName) {
            case 'openFile':
                return this.openFile();
            case 'saveFile':
                return this.saveFile(
                    payload.params[0] as string,
                    payload.params[1] as string,
                    payload.params[2] as string,
                );
            case 'duplicateTab':
                return this.duplicateTab(payload.params[0] as string);
            case 'copyToClipboard':
                return this.copyToClipboard(payload.params[0] as string);
            case 'connectToDatabase':
                return this.connectToDatabase();
            case 'disconnectFromDatabase':
                return this.disconnectFromDatabase();
            case 'runQuery':
                return this.runQuery(payload.params[0] as string, payload.params[1] as ResultViewMetadata);
            case 'stopQuery':
                return this.stopQuery(payload.params[0] as string);
            case 'nextPage':
                return this.nextPage(payload.params[0] as string);
            case 'prevPage':
                return this.prevPage(payload.params[0] as string);
            case 'firstPage':
                return this.firstPage(payload.params[0] as string);
            case 'openDocument':
                return this.openDocument(payload.params[0] as string, payload.params[1] as CosmosDBRecordIdentifier);
            case 'deleteDocument':
                return this.deleteDocument(payload.params[0] as CosmosDBRecordIdentifier);
            case 'provideFeedback':
                return this.provideFeedback();
            case 'saveCSV':
                return this.saveCSV(
                    payload.params[0] as string,
                    payload.params[1] as SerializedQueryResult | null,
                    payload.params[2] as PartitionKeyDefinition,
                    payload.params[3] as number[],
                );
            case 'saveMetricsCSV':
                return this.saveMetricsCSV(
                    payload.params[0] as string,
                    payload.params[1] as SerializedQueryResult | null,
                );
            case 'copyCSVToClipboard':
                return this.copyCSVToClipboard(
                    payload.params[0] as SerializedQueryResult | null,
                    payload.params[1] as PartitionKeyDefinition,
                    payload.params[2] as number[],
                );
            case 'copyMetricsCSVToClipboard':
                return this.copyMetricsCSVToClipboard(payload.params[0] as SerializedQueryResult | null);
            case 'updateQueryHistory':
                return this.updateQueryHistory(payload.params[0] as string);
        }

        return super.getCommand(payload);
    }

    private async updateConnection(connection?: NoSqlQueryConnection): Promise<void> {
        this.connection = connection;

        if (this.connection) {
            const { databaseId, containerId, endpoint, credentials } = this.connection;
            const masterKey = getCosmosDBKeyCredential(credentials)?.key;

            this.telemetryContext.addMaskedValue([databaseId, containerId, endpoint, masterKey ?? '']);

            const client = getCosmosDBClientByConnection(this.connection);
            const container = await client.database(databaseId).container(containerId).read();

            if (container.resource === undefined) {
                // Should be impossible since here we have a connection from the extension
                throw new Error(l10n.t('Container {0} not found', containerId));
            }

            // Probably need to pass the entire container object to the webview
            const containerDefinition = container.resource;
            const params: (PartitionKeyDefinition | string)[] = [databaseId, containerId];

            // If container is old and doesn't have partitionKey, we should pass an undefined
            if (containerDefinition.partitionKey) {
                params.push(containerDefinition.partitionKey);
            }

            this.panel.title = `${databaseId}/${containerId}`;

            await this.channel.postMessage({
                type: 'event',
                name: 'databaseConnected',
                params,
            });
        } else {
            this.panel.title = QueryEditorTab.title;
            // We will not remove the connection details from the telemetry context
            // to prevent accidental logging of sensitive information
            await this.channel.postMessage({
                type: 'event',
                name: 'databaseDisconnected',
                params: [],
            });
        }
    }

    private async openFile(): Promise<void> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: l10n.t('Select'),
            canSelectFiles: true,
            canSelectFolders: false,
            title: l10n.t('Select query'),
            filters: {
                'Query files': ['sql', 'nosql'],
                'Text files': ['txt'],
            },
        };

        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.openFile', async () => {
            await vscode.window.showOpenDialog(options).then((fileUri) => {
                if (fileUri && fileUri[0]) {
                    return vscode.workspace.openTextDocument(fileUri[0]).then((document) => {
                        void this.channel.postMessage({
                            type: 'event',
                            name: 'fileOpened',
                            params: [document.getText()],
                        });
                    });
                } else {
                    return undefined;
                }
            });
        });
    }

    private async saveFile(text: string, filename: string, ext: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.saveFile', async () => {
            if (!ext.startsWith('.')) {
                ext = `.${ext}`;
            }
            await vscodeUtil.showNewFile(text, filename, ext);
        });
    }

    private async updateQueryHistory(query?: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.updateQueryHistory', async (context) => {
            context.telemetry.suppressIfSuccessful = true;

            if (!this.connection) {
                throw new Error(l10n.t('No connection'));
            }

            const storage = StorageService.get(StorageNames.Default);
            const containerId = `${this.connection.databaseId}/${this.connection.containerId}`;
            const historyItems = (await storage.getItems(HISTORY_STORAGE_KEY)) as HistoryItem[];
            const historyData = historyItems.find((item) => item.id === containerId) ?? {
                id: containerId,
                name: containerId,
                properties: {
                    history: [] as string[],
                },
            };

            // First remove any existing occurrences of this query
            const queryHistory = historyData.properties.history.filter((item) => item !== query);

            // Add the new query to the beginning (most recent first)
            if (query) {
                queryHistory.unshift(query);
            }

            // Trim to max size if needed
            if (queryHistory.length > QUERY_HISTORY_SIZE) {
                queryHistory.length = QUERY_HISTORY_SIZE;
            }

            historyData.properties.history = queryHistory;
            await storage.push(HISTORY_STORAGE_KEY, historyData);

            // Update the webview with the new history
            await this.channel.postMessage({
                type: 'event',
                name: 'updateQueryHistory',
                params: [historyData.properties.history],
            });
        });
    }

    private async duplicateTab(text: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.duplicateTab', () => {
            QueryEditorTab.render(this.connection, this.panel.viewColumn, false, text);
        });
    }

    private async copyToClipboard(text: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.copyToClipboard', async () => {
            await vscode.env.clipboard.writeText(text);
        });
    }

    private async connectToDatabase(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.connectToDatabase', async (context) => {
            await getNoSqlQueryConnection().then(async (connection) => {
                if (connection) {
                    const { databaseId, containerId } = connection;
                    context.telemetry.properties.databaseId = crypto
                        .createHash('sha256')
                        .update(databaseId)
                        .digest('hex');
                    context.telemetry.properties.containerId = crypto
                        .createHash('sha256')
                        .update(containerId)
                        .digest('hex');
                    context.telemetry.properties.isEmulator = connection.isEmulator.toString();

                    await this.updateConnection(connection);
                }
            });
        });
    }

    private async disconnectFromDatabase(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.disconnectFromDatabase', async () => {
            return this.updateConnection(undefined);
        });
    }

    private async runQuery(query: string, options: ResultViewMetadata): Promise<void> {
        const callbackId = 'cosmosDB.nosql.queryEditor.runQuery';
        await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
            if (!this.connection) {
                throw new Error(l10n.t('No connection'));
            }

            const session = new QuerySession(this.connection, this.channel, query, options);

            context.telemetry.properties.executionId = session.id;

            this.sessions.set(session.id, session);

            await session.run();
        });
        void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.High, callbackId);
    }

    private async stopQuery(executionId: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.stopQuery', async (context) => {
            context.telemetry.properties.executionId = executionId;

            const session = this.sessions.get(executionId);
            if (!session) {
                throw new Error(l10n.t('No session found for executionId: {executionId}', { executionId }));
            }

            await session.stop();
            this.sessions.delete(executionId);
        });
    }

    private async nextPage(executionId: string): Promise<void> {
        const callbackId = 'cosmosDB.nosql.queryEditor.nextPage';
        await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
            context.telemetry.properties.executionId = executionId;

            if (!this.connection) {
                throw new Error(l10n.t('No connection'));
            }

            const session = this.sessions.get(executionId);
            if (!session) {
                throw new Error(l10n.t('No session found for executionId: {executionId}', { executionId }));
            }

            await session.nextPage();
        });
        void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
    }

    private async prevPage(executionId: string): Promise<void> {
        const callbackId = 'cosmosDB.nosql.queryEditor.prevPage';
        await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
            context.telemetry.properties.executionId = executionId;

            if (!this.connection) {
                throw new Error(l10n.t('No connection'));
            }

            const session = this.sessions.get(executionId);
            if (!session) {
                throw new Error(l10n.t('No session found for executionId: {executionId}', { executionId }));
            }

            await session.prevPage();
        });
        void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
    }

    private async firstPage(executionId: string): Promise<void> {
        const callbackId = 'cosmosDB.nosql.queryEditor.firstPage';
        await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
            context.telemetry.properties.executionId = executionId;

            if (!this.connection) {
                throw new Error(l10n.t('No connection'));
            }

            const session = this.sessions.get(executionId);
            if (!session) {
                throw new Error(l10n.t('No session found for executionId: {executionId}', { executionId }));
            }

            await session.firstPage();
        });
        void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
    }

    private async openDocument(mode: string, documentId?: CosmosDBRecordIdentifier): Promise<void> {
        const callbackId = 'cosmosDB.nosql.queryEditor.openDocument';
        await callWithTelemetryAndErrorHandling(callbackId, () => {
            if (!this.connection) {
                throw new Error(l10n.t('No connection'));
            }

            if (!documentId && mode !== 'add') {
                throw new Error(l10n.t('Impossible to open an item without an id'));
            }

            if (mode !== 'edit' && mode !== 'view' && mode !== 'add') {
                throw new Error(l10n.t('Invalid mode: {0}', mode));
            }

            DocumentTab.render(this.connection, mode, documentId, this.getNextViewColumn());
        });
        void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
    }

    private async deleteDocument(documentId: CosmosDBRecordIdentifier): Promise<void> {
        const callbackId = 'cosmosDB.nosql.queryEditor.deleteDocument';
        await callWithTelemetryAndErrorHandling(callbackId, async () => {
            if (!this.connection) {
                throw new Error(l10n.t('No connection'));
            }

            if (!documentId) {
                throw new Error(l10n.t('Impossible to open an item without an id'));
            }

            const session = new DocumentSession(this.connection, this.channel);
            await session.delete(documentId);
        });
        void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
    }

    private getNextViewColumn(): vscode.ViewColumn {
        let viewColumn = this.panel.viewColumn ?? vscode.ViewColumn.Active;
        if (viewColumn === vscode.ViewColumn.Nine) {
            viewColumn = vscode.ViewColumn.One;
        } else {
            viewColumn += 1;
        }

        return viewColumn;
    }

    private async provideFeedback(): Promise<void> {
        openSurvey(ExperienceKind.NoSQL, 'cosmosDB.nosql.queryEditor.provideFeedback');
        return Promise.resolve();
    }

    private async saveCSV(
        name: string,
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        const text = await queryResultToCsv(currentQueryResult, partitionKey, selection);
        await vscodeUtil.showNewFile(text, name, '.csv');
    }

    private async saveMetricsCSV(name: string, currentQueryResult: SerializedQueryResult | null): Promise<void> {
        const text = await queryMetricsToCsv(currentQueryResult);
        await vscodeUtil.showNewFile(text, name, '.csv');
    }

    private async copyCSVToClipboard(
        currentQueryResult: SerializedQueryResult | null,
        partitionKey?: PartitionKeyDefinition,
        selection?: number[],
    ): Promise<void> {
        const text = await queryResultToCsv(currentQueryResult, partitionKey, selection);
        await vscode.env.clipboard.writeText(text);
    }

    private async copyMetricsCSVToClipboard(currentQueryResult: SerializedQueryResult | null): Promise<void> {
        const text = await queryMetricsToCsv(currentQueryResult);
        await vscode.env.clipboard.writeText(text);
    }
}
