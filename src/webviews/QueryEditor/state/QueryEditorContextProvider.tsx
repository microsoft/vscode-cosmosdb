/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Toast, ToastBody, ToastTitle, ToastTrigger } from '@fluentui/react-components';
import * as React from 'react';
import { type ResultViewMetadata, type SerializedQueryResult } from '../../../docdb/types/queryResult';
import { type Channel } from '../../../panels/Communication/Channel/Channel';
import { type DispatchAction, type EditMode, type TableViewMode } from './QueryEditorState';

export class QueryEditorContextProvider {
    constructor(
        private readonly channel: Channel,
        private readonly dispatch: (action: DispatchAction) => void,
        private readonly dispatchToast: (content: React.ReactNode, options?: unknown) => void,
    ) {
        this.initEventListeners();
        void this.channel.postMessage({ type: 'event', name: 'ready', params: [] });
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

    public async showInformationMessage(message: string) {
        await this.sendCommand('showInformationMessage', message);
    }
    public async showErrorMessage(message: string) {
        await this.sendCommand('showErrorMessage', message);
    }

    public setPageSize(pageSize: number) {
        void this.reportWebviewEvent('setPageSize', { pageSize: pageSize.toString() });
        this.dispatch({ type: 'setPageSize', pageSize });
    }

    public setTableViewMode(mode: TableViewMode) {
        void this.reportWebviewEvent('setTableViewMode', { mode });
        this.dispatch({ type: 'setTableViewMode', mode });
    }
    public setEditMode(mode: EditMode) {
        void this.reportWebviewEvent('setEditMode', { mode });
        this.dispatch({ type: 'setEditMode', mode });
    }

    public async reportWebviewEvent(
        eventName: string,
        properties: Record<string, string> = {},
        measurements: Record<string, number> = {},
    ) {
        await this.sendCommand('reportEvent', eventName, properties, measurements);
    }
    public async reportWebviewError(
        message: string,
        stack: string | undefined,
        componentStack: string | null | undefined,
    ) {
        // Error is not JSON serializable, so the original Error object cannot be sent to the webview host.
        // Send only the relevant fields
        await this.sendCommand('reportWebviewError', message, stack, componentStack);
    }
    public async executeReportIssueCommand() {
        await this.sendCommand('executeReportIssueCommand');
    }

    private async sendCommand(command: string, ...args: unknown[]): Promise<void> {
        try {
            // Don't remove await here, we need to catch the error
            await this.channel.postMessage({
                type: 'event',
                name: 'command',
                params: [
                    {
                        commandName: command,
                        params: args,
                    },
                ],
            });
        } catch (error) {
            try {
                await this.showErrorMessage(`Failed to execute command ${command}: ${error}`);
            } catch {
                // Ignore
            }
        }
    }

    private initEventListeners() {
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
            this.dispatchToast(
                <Toast>
                    <ToastTitle
                        action={
                            <ToastTrigger>
                                <Link>Dismiss</Link>
                            </ToastTrigger>
                        }
                    >
                        Query error
                    </ToastTitle>
                    <ToastBody style={{ whiteSpace: 'pre-wrap' }}>{error}</ToastBody>
                </Toast>,
                {
                    intent: 'error',
                    pauseOnHover: true,
                    pauseOnWindowBlur: true,
                    timeout: 5000,
                },
            );
        });
    }

    public dispose() {
        this.channel.removeAllListeners();
    }
}
