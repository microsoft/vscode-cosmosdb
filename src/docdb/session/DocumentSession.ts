/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbortError, ErrorResponse, TimeoutError, type ItemDefinition, type Resource } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { extractPartitionKey } from '../../utils/document';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { ItemService } from '../services/ItemService';
import { type CosmosDbRecordIdentifier } from '../types/queryResult';

export class DocumentSession {
    public readonly id: string;

    private readonly itemService: ItemService;

    private isDisposed = false;

    constructor(
        private readonly connection: NoSqlQueryConnection,
        private readonly channel: Channel,
    ) {
        this.itemService = new ItemService(connection);

        this.id = uuid();
        this.channel = channel;
    }

    public async create(document: ItemDefinition): Promise<CosmosDbRecordIdentifier | undefined> {
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.create', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error('Session is disposed');
            }

            try {
                const record = await this.itemService.create(document);
                const partitionKeyDefinition = await this.itemService.getPartitionKey();

                if (record) {
                    await this.channel.postMessage({
                        type: 'event',
                        name: 'setDocument',
                        params: [this.id, record, partitionKeyDefinition],
                    });

                    return {
                        id: record.id,
                        _rid: record._rid,
                        partitionKey: partitionKeyDefinition
                            ? extractPartitionKey(record, partitionKeyDefinition)
                            : undefined,
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
                throw new Error('Session is disposed');
            }

            if (documentId.id === undefined || documentId._rid === undefined) {
                throw new Error('Document id or _rid is required');
            }

            try {
                const record = await this.itemService.read(documentId.id, documentId.partitionKey, documentId._rid);

                if (record) {
                    const partitionKey = await this.itemService.getPartitionKey();

                    await this.channel.postMessage({
                        type: 'event',
                        name: 'setDocument',
                        params: [this.id, record, partitionKey],
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
                throw new Error('Session is disposed');
            }

            if (documentId.id === undefined || document.id === undefined) {
                throw new Error('Document id is required');
            }

            try {
                const record = await this.itemService.update(
                    document as ItemDefinition & Resource,
                    documentId.partitionKey,
                );
                if (record) {
                    const partitionKeyDefinition = await this.itemService.getPartitionKey();

                    await this.channel.postMessage({
                        type: 'event',
                        name: 'setDocument',
                        params: [this.id, record, documentId.partitionKey],
                    });

                    return {
                        id: record.id,
                        _rid: record._rid,
                        partitionKey: partitionKeyDefinition
                            ? extractPartitionKey(record, partitionKeyDefinition)
                            : undefined,
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
                throw new Error('Session is disposed');
            }

            if (documentId.id === undefined) {
                throw new Error('Document id is required');
            }

            try {
                const result = await this.itemService.delete(documentId.id, documentId.partitionKey);

                if (result) {
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
                    throw new Error('Session is disposed');
                }

                const newDocument = this.itemService.generateNewItemTemplate();
                const partitionKeyDefinition = await this.itemService.getPartitionKey();

                await this.channel.postMessage({
                    type: 'event',
                    name: 'setDocument',
                    params: [this.id, newDocument, partitionKeyDefinition],
                });
            },
        );
    }

    public dispose(): void {
        this.isDisposed = true;
        this.itemService.dispose();
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
        } else if (error instanceof TimeoutError) {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, 'Query timed out'],
            });
        } else if (error instanceof AbortError || (isObject && 'name' in error && error.name === 'AbortError')) {
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, 'Query was aborted'],
            });
        } else {
            // always force unexpected query errors to be included in report issue command
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            await this.channel.postMessage({
                type: 'event',
                name: 'queryError',
                params: [this.id, parseError(error)],
            });
        }

        throw error;
    }

    private setTelemetryProperties(context: IActionContext): void {
        const { masterKey, endpoint, databaseId, containerId } = this.connection;

        context.valuesToMask.push(masterKey ?? '', endpoint, databaseId, containerId);

        context.errorHandling.suppressDisplay = true;
        context.errorHandling.suppressReportIssue = true;

        context.telemetry.properties.sessionId = this.id;
        context.telemetry.properties.databaseId = crypto.createHash('sha256').update(databaseId).digest('hex');
        context.telemetry.properties.containerId = crypto.createHash('sha256').update(containerId).digest('hex');
    }
}
