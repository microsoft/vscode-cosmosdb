/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbortError, ErrorResponse, TimeoutError, type QueryIterator } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { getErrorMessage } from '../../panels/Communication/Channel/CommonChannel';
import { localize } from '../../utils/localize';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { getCosmosClientByConnection } from '../getCosmosClient';
import {
    DEFAULT_EXECUTION_TIMEOUT,
    DEFAULT_PAGE_SIZE,
    type QueryResultRecord,
    type ResultViewMetadata,
} from '../types/queryResult';
import { DocumentSession } from './DocumentSession';
import { QuerySessionResult } from './QuerySessionResult';

export class QuerySession {
    public readonly id: string;
    private readonly channel: Channel;
    private readonly connection: NoSqlQueryConnection;
    private readonly databaseId: string;
    private readonly containerId: string;
    private readonly resultViewMetadata: ResultViewMetadata = {};
    private readonly query: string;
    // For telemetry
    private readonly endpoint: string;
    private readonly masterKey: string;

    private readonly sessionResult: QuerySessionResult;

    private abortController: AbortController | null = null;
    private iterator: QueryIterator<QueryResultRecord> | null = null;
    private currentIteration = 0;
    private isDisposed = false;

    constructor(
        connection: NoSqlQueryConnection,
        channel: Channel,
        query: string,
        resultViewMetadata: ResultViewMetadata,
    ) {
        const { databaseId, containerId, endpoint, masterKey } = connection;

        this.id = uuid();
        this.channel = channel;
        this.connection = connection;
        this.databaseId = databaseId;
        this.containerId = containerId;
        this.endpoint = endpoint;
        this.masterKey = masterKey ?? '';
        this.resultViewMetadata = resultViewMetadata;
        this.query = query;

        this.sessionResult = new QuerySessionResult(this.query, resultViewMetadata);
    }

    public async run(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.session.run', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (this.iterator) {
                throw new Error('Session is already running');
            }

            const isFetchAll = this.resultViewMetadata.countPerPage === -1;

            try {
                this.abortController = new AbortController();

                const client = getCosmosClientByConnection(this.connection, {
                    connectionPolicy: {
                        requestTimeout: this.resultViewMetadata.timeout ?? DEFAULT_EXECUTION_TIMEOUT,
                    },
                });

                this.iterator = client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .items.query<QueryResultRecord>(this.query, {
                        abortSignal: this.abortController.signal,
                        populateQueryMetrics: true,
                        populateIndexMetrics: true,
                        maxItemCount: isFetchAll
                            ? undefined
                            : (this.resultViewMetadata?.countPerPage ?? DEFAULT_PAGE_SIZE),
                        maxDegreeOfParallelism: 1000,
                        bufferItems: true,
                        forceQueryPlan: true,
                    });

                if (this.resultViewMetadata.countPerPage === -1) {
                    await this.fetchAll();
                } else {
                    await this.nextPage();
                }
            } catch (error) {
                await this.errorHandling(error, context);
            }
        });
    }

    public async fetchAll(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.session.fetchAll', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (!this.iterator) {
                throw new Error('Session is not running! Please run the session first');
            }

            await this.wrappedFetch(context, async () => {
                const response = await this.iterator!.fetchAll();
                this.sessionResult.push(response);
                this.currentIteration++;
            });
        });
    }

    public async nextPage(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.session.nextPage', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (!this.iterator) {
                throw new Error('Session is not running! Please run the session first');
            }

            if (this.resultViewMetadata.countPerPage === -1) {
                throw new Error('Cannot fetch next page if all records have been fetched before');
            }

            if (this.sessionResult.getResult(this.currentIteration)?.hasMoreResults === false) {
                throw new Error('Cannot fetch next page if current page is the last page');
            }

            await this.wrappedFetch(context, async () => {
                if (this.currentIteration + 1 > this.sessionResult.iterationsCount) {
                    const response = await this.iterator!.fetchNext();
                    this.sessionResult.push(response);
                }

                this.currentIteration++;
            });
        });
    }

    public async prevPage(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.session.prevPage', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (!this.iterator) {
                throw new Error('Session is not running! Please run the session first');
            }

            if (this.resultViewMetadata.countPerPage === -1) {
                throw new Error('Cannot fetch previous page if all records have been fetched before');
            }

            if (this.currentIteration - 1 <= 0) {
                throw new Error('Cannot fetch previous page if current page is the first page');
            }

            await this.wrappedFetch(context, async () => {
                this.currentIteration--;
            });
        });
    }

    public async firstPage(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.session.firstPage', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (!this.iterator) {
                throw new Error('Session is not running! Please run the session first');
            }

            await this.wrappedFetch(context, async () => {
                this.currentIteration = 1;
            });
        });
    }

    public async stop(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.session.stop', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (!this.iterator) {
                throw new Error('Session is not running! Please run the session first');
            }

            try {
                this.abortController?.abort();
            } catch (error) {
                await this.errorHandling(error, context);
            } finally {
                this.iterator = null;

                await this.channel.postMessage({
                    type: 'event',
                    name: 'executionStopped',
                    params: [this.id, Date.now()],
                });
            }
        });
    }

    public getDocumentId(row: number): Promise<QueryResultRecord | undefined> {
        const result = this.sessionResult.getResult(this.currentIteration);
        if (!result) {
            throw new Error('No result found for current iteration');
        }

        const document = result.documents[row];
        if (!document) {
            throw new Error(`No document found for row: ${row}`);
        }

        const session = new DocumentSession(this.connection, this.channel);
        return session.getDocumentId(document);
    }

    public async deleteDocument(row: number): Promise<void> {
        const result = this.sessionResult.getResult(this.currentIteration);
        if (!result) {
            throw new Error('No result found for current iteration');
        }

        const document = result.documents[row];
        if (!document) {
            throw new Error(`No document found for row: ${row}`);
        }

        const session = new DocumentSession(this.connection, this.channel);
        const documentId = await session.getDocumentId(document);

        if (!documentId) {
            throw new Error('Document id not found');
        }

        const isDeleted = await session.delete(documentId);
        if (isDeleted) {
            result.deletedDocuments.push(row);

            await this.channel.postMessage({
                type: 'event',
                name: 'queryResults',
                params: [this.id, this.sessionResult.getSerializedResult(this.currentIteration), this.currentIteration],
            });
        }
    }

    public dispose(): void {
        this.isDisposed = true;
        this.abortController?.abort();
    }

    private async errorHandling(error: unknown, context: IActionContext): Promise<void> {
        const isObject = error && typeof error === 'object';
        if (error instanceof ErrorResponse) {
            const code: string = `${error.code ?? 'Unknown'}`;
            const message: string = error.body?.message ?? `Query failed with status code ${code}`;
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, message],
            });
            void this.logAndThrowError('Query failed', error);
        } else if (error instanceof TimeoutError) {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, 'Query timed out'],
            });
            void this.logAndThrowError('Query timed out', error);
        } else if (error instanceof AbortError || (isObject && 'name' in error && error.name === 'AbortError')) {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, 'Query was aborted'],
            });
            void this.logAndThrowError('Query was aborted', error);
        } else {
            // always force unexpected query errors to be included in report issue command
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, getErrorMessage(error)],
            });
            await this.logAndThrowError('Query failed', error);
        }
    }

    private async wrappedFetch(context: IActionContext, action: () => Promise<void>): Promise<void> {
        try {
            await this.channel.postMessage({
                type: 'event',
                name: 'executionStarted',
                params: [this.id, Date.now()],
            });

            await action();

            await this.channel.postMessage({
                type: 'event',
                name: 'queryResults',
                params: [this.id, this.sessionResult.getSerializedResult(this.currentIteration), this.currentIteration],
            });
        } catch (error) {
            await this.errorHandling(error, context);
        } finally {
            await this.channel.postMessage({
                type: 'event',
                name: 'executionStopped',
                params: [this.id, Date.now()],
            });
        }
    }

    private async logAndThrowError(message: string, error: unknown = undefined): Promise<void> {
        if (error) {
            //TODO: parseError does not handle "Message : {JSON}" format coming from Cosmos DB SDK
            // we need to parse the error message and show it in a better way in the UI
            const parsedError = parseError(error);
            ext.outputChannel.error(`${message}: ${parsedError.message}`);

            if (parsedError.message) {
                message = `${message}\n${parsedError.message}`;
            }

            if (error instanceof ErrorResponse && error.message.indexOf('ActivityId:') === 0) {
                message = `${message}\nActivityId: ${error.ActivityId}`;
            }

            const showLogButton = localize('goToOutput', 'Go to output');
            if (await vscode.window.showErrorMessage(message, showLogButton)) {
                ext.outputChannel.show();
            }
            throw new Error(`${message}, ${parsedError.message}`);
        } else {
            await vscode.window.showErrorMessage(message);
            throw new Error(message);
        }
    }

    private setTelemetryProperties(context: IActionContext): void {
        context.valuesToMask.push(this.query, this.masterKey, this.endpoint, this.databaseId, this.containerId);

        context.errorHandling.suppressDisplay = true;
        context.errorHandling.suppressReportIssue = true;

        context.telemetry.properties.sessionId = this.id;
        context.telemetry.properties.query = crypto.createHash('sha256').update(this.query).digest('hex');
        context.telemetry.properties.databaseId = crypto.createHash('sha256').update(this.databaseId).digest('hex');
        context.telemetry.properties.containerId = crypto.createHash('sha256').update(this.containerId).digest('hex');
        context.telemetry.properties.countPerPage = this.resultViewMetadata?.countPerPage?.toString() ?? '';
    }
}
