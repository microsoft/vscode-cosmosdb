/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbortError, ErrorResponse, TimeoutError, type CosmosClient, type QueryIterator } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { getErrorMessage } from '../../panels/Communication/Channel/CommonChannel';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { getCosmosClient, type CosmosDBCredential } from '../getCosmosClient';
import { type ResultViewMetadata } from '../types/queryResult';
import { SessionResult } from './SessionResult';

export class CosmosDBSession {
    public readonly id: string;
    private readonly channel: Channel;
    private readonly client: CosmosClient;
    private readonly databaseId: string;
    private readonly containerId: string;
    private readonly resultViewMetadata: ResultViewMetadata = {};
    private readonly query: string;
    // For telemetry
    private readonly endpoint: string;
    private readonly masterKey: string;

    private readonly sessionResult: SessionResult;

    private abortController: AbortController | null = null;
    private iterator: QueryIterator<unknown> | null = null;
    private currentIteration = 0;
    private isDisposed = false;

    constructor(
        connection: NoSqlQueryConnection,
        channel: Channel,
        query: string,
        resultViewMetadata: ResultViewMetadata,
    ) {
        const { databaseId, containerId, endpoint, masterKey, isEmulator } = connection;
        const credentials: CosmosDBCredential[] = [];
        if (masterKey !== undefined) {
            credentials.push({ type: 'key', key: masterKey });
        }
        credentials.push({ type: 'auth' });

        this.id = uuid();
        this.channel = channel;
        this.client = getCosmosClient(endpoint, credentials, isEmulator);
        this.databaseId = databaseId;
        this.containerId = containerId;
        this.endpoint = endpoint;
        this.masterKey = masterKey ?? '';
        this.resultViewMetadata = resultViewMetadata;
        this.query = query;

        this.sessionResult = new SessionResult(resultViewMetadata);
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

            try {
                this.abortController = new AbortController();
                this.iterator = this.client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .items.query(this.query, {
                        abortSignal: this.abortController.signal,
                        populateQueryMetrics: true,
                        maxItemCount: this.resultViewMetadata?.countPerPage ?? 100,
                        maxDegreeOfParallelism: 1000,
                        bufferItems: true,
                    });

                if (this.resultViewMetadata.countPerPage === -1) {
                    await this.fetchAll();
                } else {
                    await this.nextPage();
                }
            } catch (error) {
                await this.errorHandling(error);
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

            await this.wrappedFetch(async () => {
                const response = await this.iterator!.fetchAll();
                this.sessionResult.push(response);
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

            await this.wrappedFetch(async () => {
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

            if (this.currentIteration - 1 < 0) {
                throw new Error('Cannot fetch previous page if current page is the first page');
            }

            await this.wrappedFetch(async () => {
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

            await this.wrappedFetch(async () => {
                this.currentIteration = 0;
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

            this.abortController?.abort();

            await this.channel.postMessage({
                type: 'event',
                name: 'executionStopped',
                params: [this.id],
            });
        });
    }

    public dispose(): void {
        this.isDisposed = true;
        this.abortController?.abort();
    }

    private async errorHandling(error: unknown): Promise<void> {
        if (error instanceof ErrorResponse) {
            const code: string = `${error.code ?? 'Unknown'}`;
            const message: string = error.body?.message ?? `Query failed with status code ${code}`;
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, message],
            });
        } else if (error instanceof TimeoutError) {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, 'Query timed out'],
            });
        } else if (error instanceof AbortError) {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, 'Query was aborted'],
            });
        } else {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, getErrorMessage(error)],
            });
        }

        throw error;
    }

    private async wrappedFetch(action: () => Promise<void>): Promise<void> {
        try {
            await this.channel.postMessage({
                type: 'event',
                name: 'executionStarted',
                params: [this.id],
            });

            await action();

            await this.channel.postMessage({
                type: 'event',
                name: 'queryResults',
                params: [this.id, this.sessionResult.getSerializedResult(this.currentIteration), this.currentIteration],
            });
        } catch (error) {
            await this.errorHandling(error);
        }
    }

    private setTelemetryProperties(context: IActionContext): void {
        context.valuesToMask.push(this.query, this.masterKey, this.endpoint, this.databaseId, this.containerId);

        context.telemetry.eventVersion = 1;

        context.errorHandling.suppressReportIssue = true;

        context.telemetry.properties.sessionId = this.id;
        context.telemetry.properties.query = crypto.createHash('sha256').update(this.query).digest('hex');
        context.telemetry.properties.databaseId = crypto.createHash('sha256').update(this.databaseId).digest('hex');
        context.telemetry.properties.containerId = crypto.createHash('sha256').update(this.containerId).digest('hex');
        context.telemetry.properties.countPerPage = this.resultViewMetadata?.countPerPage?.toString() ?? '';
    }
}
