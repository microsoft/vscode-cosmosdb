/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getNoSqlQueryConnection } from '../docdb/commands/connectNoSqlContainer';
import { CosmosDBSession } from '../docdb/session/CosmosDBSession';
import { type ResultViewMetadata } from '../docdb/types/queryResult';
import * as vscodeUtil from '../utils/vscodeUtils';
import { TabBase, type CommandPayload } from './TabBase';

export class QueryEditorTab extends TabBase {
    protected processCommand(payload: CommandPayload): Promise<void> {
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
            case 'showInformationMessage':
                return this.showInformationMessage(payload.params[0] as string);
            case 'showErrorMessage':
                return this.showErrorMessage(payload.params[0] as string);
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
            case 'reportWebviewEvent':
                return this.telemetryContext.reportWebviewEvent(
                    payload.params[0] as string,
                    payload.params[1] as Record<string, string>,
                    payload.params[2] as Record<string, number>,
                );
            case 'reportWebviewError':
                return this.telemetryContext.reportWebviewError(
                    payload.params[0] as string, // message
                    payload.params[1] as string, // stack
                    payload.params[2] as string, // componentStack
                );
            case 'executeReportIssueCommand':
                // Use an async anonymous function to convert Thenable to Promise
                return (async () => await vscode.commands.executeCommand('azureDatabases.reportIssue'))();
            default:
                throw new Error(`Unknown command: ${commandName}`);
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

    private async showInformationMessage(message: string) {
        await vscode.window.showInformationMessage(message);
    }

    private async showErrorMessage(message: string) {
        await vscode.window.showErrorMessage(message);
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

            const session = new CosmosDBSession(this.connection, this.channel, query, options);

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
}
