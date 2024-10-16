/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getNoSqlQueryConnection } from '../docdb/commands/connectNoSqlContainer';
import { getCosmosClientByConnection } from '../docdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../docdb/NoSqlCodeLensProvider';
import { DocumentSession } from '../docdb/session/DocumentSession';
import { QuerySession } from '../docdb/session/QuerySession';
import { type CosmosDbRecordIdentifier, type ResultViewMetadata } from '../docdb/types/queryResult';
import * as vscodeUtil from '../utils/vscodeUtils';
import { BaseTab, type CommandPayload } from './BaseTab';
import { DocumentTab } from './DocumentTabV2';

export class QueryEditorTab extends BaseTab {
    public static readonly viewType = 'cosmosDbQuery';
    public static readonly openTabs: Set<QueryEditorTab> = new Set<QueryEditorTab>();

    private readonly sessions = new Map<string, QuerySession>();

    private connection: NoSqlQueryConnection | undefined;

    protected constructor(panel: vscode.WebviewPanel, connection?: NoSqlQueryConnection) {
        super(panel, QueryEditorTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        QueryEditorTab.openTabs.add(this);

        this.connection = connection;

        if (connection) {
            if (connection.masterKey) {
                this.telemetryContext.addMaskedValue(connection.masterKey);
            }

            this.telemetryContext.addMaskedValue(connection.databaseId);
            this.telemetryContext.addMaskedValue(connection.containerId);
        }
    }

    public static render(connection?: NoSqlQueryConnection, viewColumn?: vscode.ViewColumn): QueryEditorTab {
        const column = viewColumn ?? vscode.ViewColumn.One;
        if (connection) {
            const openTab = [...QueryEditorTab.openTabs].find(
                (openTab) =>
                    openTab.connection?.endpoint === connection.endpoint &&
                    openTab.connection?.databaseId === connection.databaseId &&
                    openTab.connection?.containerId === connection.containerId,
            );
            if (openTab) {
                openTab.panel.reveal(column);
                return openTab;
            }
        }

        const panel = vscode.window.createWebviewPanel(QueryEditorTab.viewType, 'Query Editor', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new QueryEditorTab(panel, connection);
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
                return this.openDocument(payload.params[0] as string, payload.params[1] as CosmosDbRecordIdentifier);
            case 'deleteDocument':
                return this.deleteDocument(payload.params[0] as CosmosDbRecordIdentifier);
        }

        return super.getCommand(payload);
    }

    private async updateConnection(connection?: NoSqlQueryConnection): Promise<void> {
        this.connection = connection;

        if (this.connection) {
            const { databaseId, containerId, endpoint, masterKey } = this.connection;

            this.telemetryContext.addMaskedValue([databaseId, containerId, endpoint, masterKey ?? '']);

            const client = getCosmosClientByConnection(this.connection);
            const container = await client.database(databaseId).container(containerId).read();

            if (container.resource === undefined) {
                // Should be impossible since here we have a connection from the extension
                throw new Error(`Container ${containerId} not found`);
            }

            // Probably need to pass the entire container object to the webview
            const containerDefinition = container.resource;
            const params: (PartitionKeyDefinition | string)[] = [databaseId, containerId];

            // If container is old and doesn't have partitionKey, we should pass an undefined
            if (containerDefinition.partitionKey) {
                params.push(containerDefinition.partitionKey);
            }

            await this.channel.postMessage({
                type: 'event',
                name: 'databaseConnected',
                params,
            });
        } else {
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
            openLabel: 'Select',
            canSelectFiles: true,
            canSelectFolders: false,
            title: 'Select query',
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
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.runQuery', async (context) => {
            if (!this.connection) {
                throw new Error('No connection');
            }

            const session = new QuerySession(this.connection, this.channel, query, options);

            context.telemetry.properties.executionId = session.id;

            this.sessions.set(session.id, session);

            await session.run();
        });
    }

    private async stopQuery(executionId: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.stopQuery', async (context) => {
            context.telemetry.properties.executionId = executionId;

            const session = this.sessions.get(executionId);
            if (!session) {
                throw new Error(`No session found for executionId: ${executionId}`);
            }

            await session.stop();
            this.sessions.delete(executionId);
        });
    }

    private async nextPage(executionId: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.nextPage', async (context) => {
            context.telemetry.properties.executionId = executionId;

            if (!this.connection) {
                throw new Error('No connection');
            }

            const session = this.sessions.get(executionId);
            if (!session) {
                throw new Error(`No session found for executionId: ${executionId}`);
            }

            await session.nextPage();
        });
    }

    private async prevPage(executionId: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.prevPage', async (context) => {
            context.telemetry.properties.executionId = executionId;

            if (!this.connection) {
                throw new Error('No connection');
            }

            const session = this.sessions.get(executionId);
            if (!session) {
                throw new Error(`No session found for executionId: ${executionId}`);
            }

            await session.prevPage();
        });
    }

    private async firstPage(executionId: string): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.firstPage', async (context) => {
            context.telemetry.properties.executionId = executionId;

            if (!this.connection) {
                throw new Error('No connection');
            }

            const session = this.sessions.get(executionId);
            if (!session) {
                throw new Error(`No session found for executionId: ${executionId}`);
            }

            await session.firstPage();
        });
    }

    private async openDocument(mode: string, documentId?: CosmosDbRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.openDocument', () => {
            if (!this.connection) {
                throw new Error('No connection');
            }

            if (!documentId && mode !== 'add') {
                throw new Error('Impossible to open a document without an id');
            }

            if (mode !== 'edit' && mode !== 'view' && mode !== 'add') {
                throw new Error(`Invalid mode: ${mode}`);
            }

            DocumentTab.render(this.connection, mode, documentId, this.getNextViewColumn());
        });
    }

    private async deleteDocument(documentId: CosmosDbRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.deleteDocument', async () => {
            if (!this.connection) {
                throw new Error('No connection');
            }

            if (!documentId) {
                throw new Error('Impossible to open a document without an id');
            }

            const session = new DocumentSession(this.connection, this.channel);
            void session.delete(documentId);
        });
    }

    private getNextViewColumn(): vscode.ViewColumn {
        let viewColumn = this.panel.viewColumn ?? vscode.ViewColumn.One;
        if (viewColumn === vscode.ViewColumn.Nine) {
            viewColumn = vscode.ViewColumn.One;
        } else {
            viewColumn += 1;
        }

        return viewColumn;
    }
}
