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
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { getErrorMessage } from '../../panels/Communication/Channel/CommonChannel';
import { extractPartitionKey } from '../../utils/document';
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
        const { databaseId, containerId, endpoint, masterKey, isEmulator, tenantId } = connection;
        const credentials: CosmosDBCredential[] = [];
        if (masterKey !== undefined) {
            credentials.push({ type: 'key', key: masterKey });
        }
        credentials.push({ type: 'auth', tenantId: tenantId });

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
                throw new Error(l10n.t('Session is disposed'));
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
                await this.errorHandling(error, context);
            }

            return undefined;
        });
    }

    public async read(documentId: CosmosDbRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.read', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined || documentId._rid === undefined) {
                throw new Error(l10n.t('Item id or _rid is required'));
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
                await this.errorHandling(error, context);
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
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined) {
                throw new Error(l10n.t('Item id is required'));
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
                        params: [this.id, 'Document update failed'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error, context);
            }

            return undefined;
        });
    }

    public async delete(documentId: CosmosDbRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.delete', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined) {
                throw new Error(l10n.t('Item id is required'));
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
                await this.errorHandling(error, context);
            }
        });
    }

    public async setNewDocumentTemplate(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.nosql.document.session.setNewDocumentTemplate',
            async (context) => {
                this.setTelemetryProperties(context);

                if (this.isDisposed) {
                    throw new Error(l10n.t('Session is disposed'));
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

    private async errorHandling(error: unknown, context: IActionContext): Promise<void> {
        const isObject = error && typeof error === 'object';
        if (error instanceof ErrorResponse) {
            const code: string = `${error.code ?? 'Unknown'}`;
            const message: string = error.body?.message ?? l10n.t('Query failed with status code {0}', code);
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, message],
            });
            await this.logAndThrowError(l10n.t('Query failed'), error);
        } else if (error instanceof TimeoutError) {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, l10n.t('Query timed out')],
            });
            await this.logAndThrowError(l10n.t('Query timed out'), error);
        } else if (error instanceof AbortError || (isObject && 'name' in error && error.name === 'AbortError')) {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, l10n.t('Query was aborted')],
            });
            await this.logAndThrowError(l10n.t('Query was aborted'), error);
        } else {
            // always force unexpected query errors to be included in report issue command
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, getErrorMessage(error)],
            });
            await this.logAndThrowError(l10n.t('Query failed'), error);
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
                throw new Error(l10n.t('Container {0} not found', this.containerId));
            }

            this.partitionKey = container.resource.partitionKey;
            return this.partitionKey;
        });
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

            const showLogButton = l10n.t('Go to output');
            if (await vscode.window.showErrorMessage(message, showLogButton)) {
                ext.outputChannel.show();
            }
            throw new Error(`${message}, ${parsedError.message}`);
        } else {
            await vscode.window.showErrorMessage(message);
            throw new Error(message);
        }
    }
}
