/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AbortError,
    ErrorResponse,
    TimeoutError,
    type CosmosClient,
    type ItemDefinition,
    type JSONObject,
    type PartitionKeyDefinition,
} from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { getErrorMessage } from '../../panels/Communication/Channel/CommonChannel';
import { extractPartitionKey } from '../../utils/partitionKey';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { getCosmosClient, type CosmosDBCredential } from '../getCosmosClient';
import { type CosmosDbRecord, type CosmosDbRecordIdentifier } from '../types/queryResult';

export class DocumentSession {
    public readonly id: string;
    private readonly channel: Channel;
    private readonly client: CosmosClient;
    private readonly databaseId: string;
    private readonly containerId: string;
    // For telemetry
    private readonly endpoint: string;
    private readonly masterKey: string;

    private partitionKey: PartitionKeyDefinition | undefined;
    private abortController: AbortController;
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
        this.abortController = new AbortController();
    }

    public async create(document: ItemDefinition): Promise<CosmosDbRecordIdentifier | undefined> {
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.create', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            try {
                const partitionKey = await this.getPartitionKey();

                const response = await this.client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .items.create<ItemDefinition>(document, {
                        abortSignal: this.abortController.signal,
                    });

                if (response?.resource) {
                    const record = response.resource as CosmosDbRecord;

                    await this.channel.postMessage({
                        type: 'event',
                        name: 'setDocument',
                        params: [this.id, record, partitionKey],
                    });

                    return {
                        id: record.id,
                        _rid: record._rid,
                        partitionKey: partitionKey ? extractPartitionKey(record, partitionKey) : undefined,
                    };
                } else {
                    await this.channel.postMessage({
                        type: 'event',
                        name: 'documentError',
                        params: [this.id, 'Document creation failed'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error);
            }

            return undefined;
        });
    }

    public async read(documentId: CosmosDbRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.read', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (documentId.id === undefined || documentId._rid === undefined) {
                throw new Error('Document id or _rid is required');
            }

            try {
                let result: CosmosDbRecord | null = null;
                const response = await this.client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .item(documentId.id, documentId.partitionKey)
                    .read<CosmosDbRecord>({
                        abortSignal: this.abortController.signal,
                    });

                if (response?.resource) {
                    result = response.resource;
                }

                // TODO: Should we try to read the document by _rid if the above fails?
                if (!result && documentId._rid) {
                    const queryResult = await this.client
                        .database(this.databaseId)
                        .container(this.containerId)
                        .items.query<CosmosDbRecord>(`SELECT * FROM c WHERE c._rid = "${documentId._rid}"`, {
                            abortSignal: this.abortController.signal,
                            bufferItems: true,
                        })
                        .fetchAll();

                    if (queryResult.resources?.length === 1) {
                        result = queryResult.resources[0];
                    }
                }

                if (result) {
                    const partitionKey = await this.getPartitionKey();

                    await this.channel.postMessage({
                        type: 'event',
                        name: 'setDocument',
                        params: [this.id, result, partitionKey],
                    });
                } else {
                    await this.channel.postMessage({
                        type: 'event',
                        name: 'documentError',
                        params: [this.id, 'Document not found'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error);
            }
        });
    }

    public async update(
        document: ItemDefinition,
        documentId: CosmosDbRecordIdentifier,
    ): Promise<CosmosDbRecordIdentifier | undefined> {
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.update', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (documentId.id === undefined) {
                throw new Error('Document id is required');
            }

            try {
                const response = await this.client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .item(documentId.id, documentId.partitionKey)
                    .replace(document, {
                        abortSignal: this.abortController.signal,
                    });

                if (response?.resource) {
                    const record = response.resource as CosmosDbRecord;
                    const partitionKey = await this.getPartitionKey();

                    await this.channel.postMessage({
                        type: 'event',
                        name: 'setDocument',
                        params: [this.id, record, partitionKey],
                    });

                    return {
                        id: record.id,
                        _rid: record._rid,
                        partitionKey: partitionKey ? extractPartitionKey(record, partitionKey) : undefined,
                    };
                } else {
                    await this.channel.postMessage({
                        type: 'event',
                        name: 'documentError',
                        params: [this.id, 'Document creation failed'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error);
            }

            return undefined;
        });
    }

    public async delete(documentId: CosmosDbRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.delete', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            if (documentId.id === undefined) {
                throw new Error('Document id is required');
            }

            try {
                const result = await this.client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .item(documentId.id, documentId.partitionKey)
                    .delete({
                        abortSignal: this.abortController.signal,
                    });

                if (result?.statusCode === 204) {
                    await this.channel.postMessage({
                        type: 'event',
                        name: 'documentDeleted',
                        params: [this.id, documentId],
                    });
                } else {
                    await this.channel.postMessage({
                        type: 'event',
                        name: 'documentError',
                        params: [this.id, 'Document deletion failed'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error);
            }
        });
    }

    public async setNewDocumentTemplate(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.nosql.document.session.setNewDocumentTemplate',
            async (context) => {
                this.setTelemetryProperties(context);

                if (this.isDisposed) {
                    throw new Error('Session is disposed');
                }

                const partitionKey = await this.getPartitionKey();

                const newDocument: JSONObject = {
                    id: 'replace_with_new_document_id',
                };
                partitionKey?.paths.forEach((partitionKeyProperty) => {
                    let target = newDocument;
                    const keySegments = partitionKeyProperty.split('/').filter((segment) => segment.length > 0);
                    const finalSegment = keySegments.pop();

                    if (!finalSegment) {
                        return;
                    }

                    // Initialize nested objects as needed
                    keySegments.forEach((segment) => {
                        target[segment] ??= {};
                        target = target[segment] as JSONObject;
                    });

                    target[finalSegment] = 'replace_with_new_partition_key_value';
                });

                await this.channel.postMessage({
                    type: 'event',
                    name: 'setDocument',
                    params: [this.id, newDocument, partitionKey],
                });
            },
        );
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

    private async getPartitionKey(): Promise<PartitionKeyDefinition | undefined> {
        if (this.partitionKey) {
            return this.partitionKey;
        }

        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.getPartitionKey', async () => {
            const container = await this.client.database(this.databaseId).container(this.containerId).read();

            if (container.resource === undefined) {
                // Should be impossible since here we have a connection from the extension
                throw new Error(`Container ${this.containerId} not found`);
            }

            this.partitionKey = container.resource.partitionKey;
            return this.partitionKey;
        });
    }
}
