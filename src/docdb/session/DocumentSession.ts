/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbortError, ErrorResponse, TimeoutError, type CosmosClient, type PartitionKey } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { getErrorMessage } from '../../panels/Communication/Channel/CommonChannel';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { getCosmosClient, type CosmosDBCredential } from '../getCosmosClient';

export class DocumentSession {
    public readonly id: string;
    private readonly channel: Channel;
    private readonly client: CosmosClient;
    private readonly databaseId: string;
    private readonly containerId: string;
    // For telemetry
    private readonly endpoint: string;
    private readonly masterKey: string;

    private abortController: AbortController | null = null;
    private isDisposed = false;

    constructor(connection: NoSqlQueryConnection, channel: Channel) {
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
    }

    public async read(documentId: string, partitionKey?: PartitionKey): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.read', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            try {
                this.abortController = new AbortController();
                const result = await this.client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .item(documentId, partitionKey)
                    .read({
                        abortSignal: this.abortController.signal,
                    });

                await this.channel.postMessage({
                    type: 'event',
                    name: 'queryResults',
                    params: [this.id, result.resource],
                });
            } catch (error) {
                await this.errorHandling(error);
            }
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

    private setTelemetryProperties(context: IActionContext): void {
        context.valuesToMask.push(this.masterKey, this.endpoint, this.databaseId, this.containerId);

        context.errorHandling.suppressDisplay = true;
        context.errorHandling.suppressReportIssue = true;

        context.telemetry.properties.sessionId = this.id;
        context.telemetry.properties.databaseId = crypto.createHash('sha256').update(this.databaseId).digest('hex');
        context.telemetry.properties.containerId = crypto.createHash('sha256').update(this.containerId).digest('hex');
    }
}
