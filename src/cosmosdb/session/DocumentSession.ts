/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AbortError,
    BulkOperationType,
    ErrorResponse,
    TimeoutError,
    type BulkOperationResult,
    type DeleteOperationInput,
    type ItemDefinition,
    type JSONObject,
    type PartitionKeyDefinition,
} from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { HttpStatusCodes } from '../../constants';
import { ext } from '../../extensionVariables';
import { type Channel } from '../../panels/Communication/Channel/Channel';
import { getErrorMessage } from '../../panels/Communication/Channel/CommonChannel';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { extractPartitionKey } from '../../utils/document';
import { getCosmosDBKeyCredential } from '../CosmosDBCredential';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';
import { type CosmosDBRecord, type CosmosDBRecordIdentifier } from '../types/queryResult';
import { withClaimsChallengeHandling } from '../withClaimsChallengeHandling';

/**
 * Is more specific type for document identifiers used for deleting documents.
 */
type DocumentId = CosmosDBRecordIdentifier & { id: string };

const isDocumentId = (documentId: CosmosDBRecordIdentifier): documentId is DocumentId => {
    return documentId.id !== undefined && documentId.id !== '';
};

type DeleteStatus = {
    valid: DocumentId[];
    invalid: CosmosDBRecordIdentifier[];
    deleted: DocumentId[];
    throttled: DocumentId[];
    failed: DocumentId[];
    aborted: boolean;
};

export class DocumentSession {
    public readonly id: string;
    private readonly channel: Channel;
    private readonly connection: NoSqlQueryConnection;
    private readonly databaseId: string;
    private readonly containerId: string;
    // For telemetry
    private readonly endpoint: string;
    private readonly masterKey: string;

    private partitionKey: PartitionKeyDefinition | undefined;
    private abortController: AbortController;
    private isDisposed = false;

    constructor(connection: NoSqlQueryConnection, channel: Channel) {
        const { databaseId, containerId, endpoint, credentials } = connection;

        this.id = uuid();
        this.channel = channel;
        this.connection = connection;
        this.databaseId = databaseId;
        this.containerId = containerId;
        this.endpoint = endpoint;
        this.masterKey = getCosmosDBKeyCredential(credentials)?.key ?? '';
        this.abortController = new AbortController();
    }

    public async create(document: ItemDefinition): Promise<CosmosDBRecordIdentifier | undefined> {
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.create', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            try {
                const partitionKey = await this.getPartitionKey();
                const response = await withClaimsChallengeHandling(this.connection, async (client) =>
                    client
                        .database(this.databaseId)
                        .container(this.containerId)
                        .items.create<ItemDefinition>(document, {
                            abortSignal: this.abortController.signal,
                        }),
                );

                if (response?.resource) {
                    const record = response.resource as CosmosDBRecord;

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
                        params: [this.id, 'Item creation failed'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error, context);
            }

            return undefined;
        });
    }

    public async read(documentId: CosmosDBRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.read', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined || documentId._rid === undefined) {
                throw new Error(l10n.t('Item id or _rid is required'));
            }

            try {
                let result: CosmosDBRecord | null = null;
                const response = await withClaimsChallengeHandling(this.connection, async (client) =>
                    client
                        .database(this.databaseId)
                        .container(this.containerId)
                        .item(documentId.id!, documentId.partitionKey)
                        .read<CosmosDBRecord>({
                            abortSignal: this.abortController.signal,
                        }),
                );

                if (response?.resource) {
                    result = response.resource;
                }

                // TODO: Should we try to read the document by _rid if the above fails?
                if (!result && documentId._rid) {
                    const queryResult = await withClaimsChallengeHandling(this.connection, async (client) =>
                        client
                            .database(this.databaseId)
                            .container(this.containerId)
                            .items.query<CosmosDBRecord>(`SELECT *FROM c WHERE c._rid = "${documentId._rid}"`, {
                                abortSignal: this.abortController.signal,
                                bufferItems: true,
                            })
                            .fetchAll(),
                    );

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
                        params: [this.id, 'Item not found'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error, context);
            }
        });
    }

    public async update(
        document: ItemDefinition,
        documentId: CosmosDBRecordIdentifier,
    ): Promise<CosmosDBRecordIdentifier | undefined> {
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.update', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined) {
                throw new Error(l10n.t('Item id is required'));
            }

            try {
                const response = await withClaimsChallengeHandling(this.connection, async (client) =>
                    client
                        .database(this.databaseId)
                        .container(this.containerId)
                        .item(documentId.id!, documentId.partitionKey)
                        .replace(document, {
                            abortSignal: this.abortController.signal,
                        }),
                );

                if (response?.resource) {
                    const record = response.resource as CosmosDBRecord;
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
                        params: [this.id, 'Item update failed'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error, context);
            }

            return undefined;
        });
    }

    public async delete(documentId: CosmosDBRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.delete', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined) {
                throw new Error(l10n.t('Item id is required'));
            }

            try {
                const result = await withClaimsChallengeHandling(this.connection, async (client) =>
                    client
                        .database(this.databaseId)
                        .container(this.containerId)
                        .item(documentId.id!, documentId.partitionKey)
                        .delete({
                            abortSignal: this.abortController.signal,
                        }),
                );

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
                        params: [this.id, 'Item deletion failed'],
                    });
                }
            } catch (error) {
                await this.errorHandling(error, context);
            }
        });
    }

    public async bulkDelete(documentIds: CosmosDBRecordIdentifier[]): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.bulkDelete', async (context) => {
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            const status: DeleteStatus = {
                valid: documentIds.filter((documentId) => isDocumentId(documentId)),
                invalid: documentIds.filter((documentId) => !isDocumentId(documentId)),
                deleted: [],
                throttled: [],
                failed: [],
                aborted: false,
            };

            const sendResponse = async () => {
                await this.channel.postMessage({
                    type: 'event',
                    name: 'bulkDelete',
                    params: [this.id, status],
                });
            };

            if (status.valid.length === 0) {
                return sendResponse();
            }

            const confirmation = await getConfirmationAsInSettings(
                l10n.t('Bulk Delete Confirmation'),
                l10n.t('Are you sure you want to delete selected item(s)?'),
                'delete',
            );

            if (!confirmation) {
                status.aborted = true;
                return sendResponse();
            }

            try {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: l10n.t('Deleting documents'),
                        cancellable: true,
                    },
                    async (progress, token) => {
                        const abortController = new AbortController();
                        const abortSignal = abortController.signal;

                        token.onCancellationRequested(async () => {
                            status.aborted = true;
                            await sendResponse();
                            abortController.abort();
                        });

                        let processedDocumentIds = Array.from(status.valid);
                        let retryAfterMilliseconds = 0;

                        while (processedDocumentIds.length > 0 && !this.isDisposed && !abortSignal.aborted) {
                            // If throttled, wait for the specified time before retrying
                            if (retryAfterMilliseconds > 0) {
                                await new Promise((resolve) => setTimeout(resolve, result.retryAfterMilliseconds));
                                processedDocumentIds = Array.from(status.throttled);
                            }

                            progress.report({ message: this.prepareDeleteProgressMessage(status) });

                            const result = await this.processBulkDelete(processedDocumentIds, abortSignal);
                            retryAfterMilliseconds = result.retryAfterMilliseconds;
                            status.deleted.push(...result.deleted);
                            status.throttled.push(...result.throttled);
                            status.failed.push(...result.failed);
                        }
                    },
                );

                if (status.aborted) {
                    this.showError(l10n.t('Bulk delete operation was aborted by the user.'));
                } else if (status.deleted.length === 0 && status.throttled.length === 0 && status.failed.length === 0) {
                    this.showError(l10n.t('No documents were deleted.'));
                } else if (status.throttled.length > 0 || status.failed.length > 0) {
                    this.showError(
                        l10n.t(
                            'Bulk delete operation completed with {deleted} deleted, {throttled} throttled, and {failed} failed documents.',
                            {
                                deleted: status.deleted.length,
                                throttled: status.throttled.length,
                                failed: status.failed.length,
                            },
                        ),
                    );
                } else {
                    this.showInfo(
                        l10n.t('Bulk delete operation completed with {count} deleted documents.', {
                            count: status.deleted.length,
                        }),
                    );
                }

                return sendResponse();
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
            const container = await withClaimsChallengeHandling(this.connection, async (client) =>
                client.database(this.databaseId).container(this.containerId).read(),
            );

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

            if (parsedError.message) {
                message = `${message}\n${parsedError.message}`;
            }

            if (error instanceof ErrorResponse && error.message.indexOf('ActivityId:') === 0) {
                message = `${message}\nActivityId: ${error.ActivityId}`;
            }

            this.showError(message);

            throw new Error(`${message}, ${parsedError.message}`);
        } else {
            vscode.window.showErrorMessage(message);
            throw new Error(message);
        }
    }

    private showError(message: string): void {
        ext.outputChannel.error(message);
        vscode.window.showErrorMessage(message, l10n.t('Go to output')).then((result) => {
            if (result) {
                ext.outputChannel.show();
            }
        });
    }

    private showInfo(message: string): void {
        ext.outputChannel.appendLog(message);
        vscode.window.showInformationMessage(message, l10n.t('Go to output')).then((result) => {
            if (result) {
                ext.outputChannel.show();
            }
        });
    }

    private prepareDeleteProgressMessage(status: DeleteStatus): string {
        const parts: string[] = [
            l10n.t('Total: {count}', { count: status.valid.length }),
            l10n.t('Deleted: {count}', { count: status.deleted.length }),
            l10n.t('Throttled: {count}', { count: status.throttled.length }),
            l10n.t('Failed: {count}', { count: status.failed.length }),
        ];

        if (status.invalid.length > 0) {
            parts.push(l10n.t('Invalid: {count}', { count: status.invalid.length }));
        }

        return parts.join(' | ');
    }

    private async processBulkDelete(processedDocumentIds: DocumentId[], abortSignal: AbortSignal) {
        if (this.isDisposed) {
            throw new Error(l10n.t('Session is disposed'));
        }

        const result = {
            deleted: [] as DocumentId[],
            throttled: [] as DocumentId[],
            failed: [] as DocumentId[],
            retryAfterMilliseconds: 0,
        };

        ext.outputChannel.appendLog(l10n.t('Deleting {count} document(s)', { count: processedDocumentIds.length }));

        // Bulk can only delete 100 documents at a time
        const BULK_DELETE_LIMIT = 100;
        const promiseArray = await withClaimsChallengeHandling(this.connection, async (client) => {
            const promiseArray: Promise<Array<BulkOperationResult & { documentId: DocumentId }>>[] = [];
            // Trying to delete as many documents as possible
            while (processedDocumentIds.length > 0 && !this.isDisposed && !abortSignal.aborted) {
                const documentIdsChunk = processedDocumentIds.splice(0, BULK_DELETE_LIMIT);
                const operations = documentIdsChunk.map(
                    (documentId): DeleteOperationInput => ({
                        id: documentId.id,
                        // bulk delete: if not partition key is specified, do not pass empty array, but undefined
                        partitionKey:
                            Array.isArray(documentId.partitionKey) && documentId.partitionKey.length === 0
                                ? undefined
                                : documentId.partitionKey,
                        operationType: BulkOperationType.Delete,
                    }),
                );

                const promise = client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .items.executeBulkOperations(operations, {
                        abortSignal,
                    })
                    .then((bulkResults) => {
                        return bulkResults.map((bulkResult, index) => {
                            const documentId = documentIdsChunk[index];
                            return { ...bulkResult, documentId };
                        });
                    });
                promiseArray.push(promise);
            }

            return promiseArray;
        });

        // Wait for all delete operations to complete
        const deleteResult = (await Promise.all(promiseArray)).flat();

        deleteResult.forEach((bulkDeleteResult) => {
            const statusCode =
                bulkDeleteResult.response?.statusCode ??
                (typeof bulkDeleteResult?.error?.code === 'number' ? bulkDeleteResult?.error?.code : null) ??
                HttpStatusCodes.BAD_REQUEST;

            const retryAfterMs =
                (bulkDeleteResult.response?.headers?.['x-ms-retry-after-ms'] as number) ??
                bulkDeleteResult.error?.retryAfterInMs ??
                300;

            if (statusCode === HttpStatusCodes.NO_CONTENT) {
                result.deleted.push(bulkDeleteResult.documentId);
            } else if (statusCode === HttpStatusCodes.TOO_MANY_REQUESTS) {
                result.retryAfterMilliseconds = Math.max(retryAfterMs, result.retryAfterMilliseconds);
                result.throttled.push(bulkDeleteResult.documentId);
            } else if (statusCode >= HttpStatusCodes.BAD_REQUEST) {
                ext.outputChannel.appendLog(
                    l10n.t('Failed to delete document {id} with status code {statusCode}. Error: {error}', {
                        id: bulkDeleteResult.documentId.id,
                        statusCode,
                        error: bulkDeleteResult.error?.body?.message ?? l10n.t('Unknown error'),
                    }),
                );
                result.failed.push(bulkDeleteResult.documentId);
            }
        });

        ext.outputChannel.appendLog(
            l10n.t('Successfully deleted {count} document(s)', { count: result.deleted.length }),
        );

        if (result.throttled.length > 0) {
            ext.outputChannel.appendLog(
                l10n.t('Failed to delete {count} document(s) due to "Request too large" (429) error. Retrying...', {
                    count: result.throttled.length,
                }),
            );
        }

        return result;
    }
}
