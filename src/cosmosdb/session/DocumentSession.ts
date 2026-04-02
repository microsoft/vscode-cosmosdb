/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AbortError,
    BulkOperationType,
    ErrorResponse,
    StatusCodes,
    TimeoutError,
    type BulkOperationResult,
    type DeleteOperationInput,
    type ItemDefinition,
    type JSONObject,
    type PartitionKey,
    type PartitionKeyDefinition,
} from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';

import { ext } from '../../extensionVariables';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { arePartitionKeysEqual, extractPartitionKey } from '../../utils/document';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { type UntypedEventEmitter } from '../../utils/TypedEventSink';
import { getCosmosDBKeyCredential } from '../CosmosDBCredential';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';
import { type CosmosDBRecord, type CosmosDBRecordIdentifier } from '../types/queryResult';
import { withClaimsChallengeHandling } from '../withClaimsChallengeHandling';

/**
 * Interface for emitting document-related events.
 * Can be backed by a TypedEventSink for Document events or Query Editor events.
 */
export interface DocumentEventEmitter {
    emitSetDocument(sessionId: string, documentContent: CosmosDBRecord, partitionKey?: PartitionKeyDefinition): void;
    emitDocumentError(sessionId: string, error: string): void;
    emitQueryError(sessionId: string, error: string): void;
    emitOperationAborted(sessionId?: string, message?: string): void;
    emitDocumentDeleted(sessionId: string, documentId: CosmosDBRecordIdentifier): void;
    emitBulkDelete(sessionId: string, status: DeleteStatus): void;
}

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


/**
 * Creates a DocumentEventEmitter that emits events to a typed document event sink.
 * Accepts an UntypedEventEmitter so it can work with both DocumentEvent and QueryEditorEvent sinks.
 */
export function createDocumentEventEmitter(sink: UntypedEventEmitter): DocumentEventEmitter {
    return {
        emitSetDocument(sessionId, documentContent, partitionKey) {
            sink.emit({ type: 'setDocument', sessionId, documentContent, partitionKey });
        },
        emitDocumentError(sessionId, error) {
            sink.emit({ type: 'documentError', sessionId, error });
        },
        emitQueryError(sessionId, error) {
            sink.emit({ type: 'queryError', sessionId, error });
        },
        emitOperationAborted(sessionId, message) {
            sink.emit({ type: 'operationAborted', sessionId, message });
        },
        emitDocumentDeleted(sessionId, documentId) {
            sink.emit({ type: 'documentDeleted', documentId, sessionId });
        },
        emitBulkDelete(sessionId, status) {
            sink.emit({ type: 'bulkDeleteComplete', results: status, sessionId });
        },
    };
}

export class DocumentSession {
    public readonly id: string;
    private readonly eventEmitter: DocumentEventEmitter;
    private readonly connection: NoSqlQueryConnection;
    private readonly databaseId: string;
    private readonly containerId: string;
    // For telemetry
    private readonly endpoint: string;
    private readonly masterKey: string;

    private partitionKey: PartitionKeyDefinition | undefined;
    private abortController: AbortController;
    private isDisposed = false;

    constructor(connection: NoSqlQueryConnection, eventEmitter: DocumentEventEmitter) {
        const { databaseId, containerId, endpoint, credentials } = connection;

        this.id = uuid();
        this.eventEmitter = eventEmitter;
        this.connection = connection;
        this.databaseId = databaseId;
        this.containerId = containerId;
        this.endpoint = endpoint;
        this.masterKey = getCosmosDBKeyCredential(credentials)?.key ?? '';
        this.abortController = new AbortController();
    }

    public async create(document: ItemDefinition): Promise<CosmosDBRecordIdentifier | undefined> {
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.create', async (context) => {
            context.errorHandling.rethrow = true;
            this.setTelemetryProperties(context);

            return this.createInternal(document, context);
        });
    }

    async createInternal(
        document: ItemDefinition,
        context: IActionContext,
    ): Promise<CosmosDBRecordIdentifier | undefined> {
        if (this.isDisposed) {
            throw new Error(l10n.t('Session is disposed'));
        }

        try {
            const response = await withClaimsChallengeHandling(this.connection, async (client) =>
                client.database(this.databaseId).container(this.containerId).items.create<ItemDefinition>(document, {
                    abortSignal: this.abortController.signal,
                }),
            );

            if (response?.resource) {
                const record = response.resource as CosmosDBRecord;

                const containerPartitionKey = await this.getPartitionKey();
                const partitionKey = containerPartitionKey
                    ? extractPartitionKey(record, containerPartitionKey)
                    : undefined;

                this.eventEmitter.emitSetDocument(this.id, record, containerPartitionKey);

                return {
                    id: record.id,
                    _rid: record._rid,
                    partitionKey: partitionKey,
                };
            } else {
                this.eventEmitter.emitDocumentError(this.id, l10n.t('Item creation failed'));
            }
        } catch (error) {
            await this.errorHandling(error, context);
        }

        return undefined;
    }

    public async read(documentId: CosmosDBRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.read', async (context) => {
            context.errorHandling.rethrow = true;
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined || documentId._rid === undefined) {
                throw new Error(l10n.t('Item id or _rid is required'));
            }

            try {
                const timeoutMs = 4000;

                const readPromise = withClaimsChallengeHandling(this.connection, async (client) =>
                    client
                        .database(this.databaseId)
                        .container(this.containerId)
                        .item(documentId.id!, documentId.partitionKey)
                        .read<CosmosDBRecord>({
                            abortSignal: this.abortController.signal,
                        }),
                );

                let result: CosmosDBRecord | undefined;
                let primaryTimeoutId: NodeJS.Timeout | undefined = undefined;
                try {
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        primaryTimeoutId = setTimeout(() => reject(new Error('Read operation timed out')), timeoutMs);
                    });

                    const response = await Promise.race([readPromise, timeoutPromise]);
                    result = response?.resource;
                } catch (primaryError) {
                    ext.outputChannel.error(
                        `[DocumentSession.read] Primary read failed: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
                    );
                    // Don't throw yet, try fallback if we have _rid
                    result = undefined;
                } finally {
                    if (primaryTimeoutId) {
                        clearTimeout(primaryTimeoutId);
                    }
                }

                // Try to read the document by _rid if the primary read fails
                if (!result && documentId._rid) {
                    const rid = documentId._rid; // Capture for closure
                    let fallbackTimeoutId: NodeJS.Timeout | undefined = undefined;
                    try {
                        const queryPromise = withClaimsChallengeHandling(this.connection, async (client) =>
                            client
                                .database(this.databaseId)
                                .container(this.containerId)
                                .items.query<CosmosDBRecord>(
                                    {
                                        query: 'SELECT * FROM c WHERE c._rid = @rid',
                                        parameters: [{ name: '@rid', value: rid }],
                                    },
                                    {
                                        abortSignal: this.abortController.signal,
                                        bufferItems: true,
                                    },
                                )
                                .fetchAll(),
                        );

                        const timeoutPromise = new Promise<never>((_, reject) => {
                            fallbackTimeoutId = setTimeout(() => {
                                ext.outputChannel.error(
                                    `[DocumentSession.read] Fallback _rid query timed out after ${timeoutMs}ms`,
                                );
                                reject(new Error('Fallback read operation timed out'));
                            }, timeoutMs);
                        });

                        const queryResult = await Promise.race([queryPromise, timeoutPromise]);

                        if (queryResult?.resources?.length === 1) {
                            result = queryResult.resources[0] as CosmosDBRecord;
                            ext.outputChannel.appendLog(`[DocumentSession.read] Document found via _rid query`);
                        } else {
                            ext.outputChannel.appendLog(
                                `[DocumentSession.read] _rid query returned ${queryResult.resources?.length ?? 0} results`,
                            );
                        }
                    } catch (fallbackError) {
                        ext.outputChannel.error(
                            `[DocumentSession.read] Fallback read failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
                        );
                        // Continue to send documentError to webview
                    } finally {
                        if (fallbackTimeoutId) {
                            clearTimeout(fallbackTimeoutId);
                        }
                    }
                }

                if (result) {
                    const containerPartitionKey = await this.getPartitionKey();
                    this.eventEmitter.emitSetDocument(this.id, result, containerPartitionKey);
                } else {
                    // No result - send documentError event (NOT queryError)
                    this.eventEmitter.emitDocumentError(this.id, l10n.t('Item not found or request timed out'));
                }
            } catch (error) {
                // Handle unexpected errors - send documentError instead of using errorHandling
                const errorMessage = error instanceof Error ? error.message : l10n.t('An unexpected error occurred');
                this.eventEmitter.emitDocumentError(this.id, errorMessage);
                // Still log telemetry but don't use errorHandling which sends queryError
                context.telemetry.properties.error = errorMessage;
            }
        });
    }

    public async update(
        document: ItemDefinition,
        documentId: CosmosDBRecordIdentifier,
    ): Promise<CosmosDBRecordIdentifier | undefined> {
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.update', async (context) => {
            context.errorHandling.rethrow = true;
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined) {
                throw new Error(l10n.t('Item id is required'));
            }

            try {
                const containerPartitionKey = await this.getPartitionKey();

                // Extract partition key from the updated document
                let newPartitionKey: PartitionKey | undefined = undefined;
                if (containerPartitionKey) {
                    newPartitionKey = extractPartitionKey(document, containerPartitionKey);
                }

                // Check if partition key has changed
                const partitionKeyChanged: boolean = !arePartitionKeysEqual(documentId.partitionKey, newPartitionKey);

                if (partitionKeyChanged) {
                    // Partition key has changed - need to delete old item and create new one
                    context.telemetry.properties.partitionKeyChanged = 'true';

                    const confirmation = await getConfirmationAsInSettings(
                        l10n.t('Partition Key changed'),
                        l10n.t(
                            'Are you sure you want to change the items partition key?\n\nThis will delete the old item and create a new one.',
                        ),
                        'change',
                    );

                    if (!confirmation) {
                        context.telemetry.properties.result = 'Canceled';
                        this.eventEmitter.emitOperationAborted(this.id);
                        return;
                    }

                    // Delete the old item
                    const deleteResult = await this.deleteInternal(documentId, context);
                    if (!deleteResult) {
                        this.eventEmitter.emitDocumentError(
                            this.id,
                            l10n.t('Deleting old item for partition key change failed'),
                        );
                        // To avoid data loss, we still save the new item even if deleting the old one failed
                        // TODO: should we abort here or prompt the user at this point if they want to create the
                        // duplicate on the new partition even if deleting the old one failed?
                    }

                    // Create the new item with the updated partition key
                    const newRecord = await this.createInternal(document, context);
                    if (!newRecord) {
                        this.eventEmitter.emitDocumentError(this.id, 'Item update with partition key change failed');
                    }
                    return newRecord;
                } else {
                    // Normal update - partition key hasn't changed
                    context.telemetry.properties.partitionKeyChanged = 'false';

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

                        this.eventEmitter.emitSetDocument(this.id, record, containerPartitionKey);

                        return {
                            id: record.id,
                            _rid: record._rid,
                            partitionKey: containerPartitionKey
                                ? extractPartitionKey(record, containerPartitionKey)
                                : undefined,
                        };
                    } else {
                        this.eventEmitter.emitDocumentError(this.id, 'Item update failed');
                    }
                }
            } catch (error) {
                await this.errorHandling(error, context);
            }

            return undefined;
        });
    }

    public async delete(documentId: CosmosDBRecordIdentifier): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.delete', async (context) => {
            context.errorHandling.rethrow = true;
            this.setTelemetryProperties(context);

            if (this.isDisposed) {
                throw new Error(l10n.t('Session is disposed'));
            }

            if (documentId.id === undefined) {
                throw new Error(l10n.t('Item id is required'));
            }

            const confirmation = await getConfirmationAsInSettings(
                l10n.t('Delete Confirmation'),
                l10n.t('Are you sure you want to delete the selected item?'),
                'delete',
            );

            if (!confirmation) {
                return;
            }

            await this.deleteInternal(documentId, context);
        });
    }

    async deleteInternal(documentId: CosmosDBRecordIdentifier, context: IActionContext): Promise<boolean> {
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
                this.eventEmitter.emitDocumentDeleted(this.id, documentId);
                return true;
            } else {
                this.eventEmitter.emitDocumentError(this.id, 'Item deletion failed');
            }
        } catch (error) {
            await this.errorHandling(error, context);
        }
        return false;
    }

    public async bulkDelete(documentIds: CosmosDBRecordIdentifier[]): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.bulkDelete', async (context) => {
            context.errorHandling.rethrow = true;
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

            const sendResponse = () => {
                this.eventEmitter.emitBulkDelete(this.id, status);
            };

            if (status.valid.length === 0) {
                sendResponse();
                return;
            }

            const confirmation = await getConfirmationAsInSettings(
                status.valid.length < 2 ? l10n.t('Delete Confirmation') : l10n.t('Bulk Delete Confirmation'),
                status.valid.length < 2
                    ? l10n.t('Are you sure you want to delete the selected item?')
                    : l10n.t('Are you sure you want to delete selected items?'),
                'delete',
            );

            if (!confirmation) {
                status.aborted = true;
                sendResponse();
                return;
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

                        token.onCancellationRequested(() => {
                            status.aborted = true;
                            sendResponse();
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

                sendResponse();
            } catch (error) {
                await this.errorHandling(error, context);
            }
        });
    }

    public async setNewDocumentTemplate(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.nosql.document.session.setNewDocumentTemplate',
            async (context) => {
                context.errorHandling.rethrow = true;
                this.setTelemetryProperties(context);

                if (this.isDisposed) {
                    throw new Error(l10n.t('Session is disposed'));
                }

                const containerPartitionKey = await this.getPartitionKey();

                const newDocument: JSONObject = {
                    id: 'replace_with_new_document_id',
                };
                containerPartitionKey?.paths.forEach((partitionKeyProperty) => {
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

                this.eventEmitter.emitSetDocument(
                    this.id,
                    newDocument as unknown as CosmosDBRecord,
                    containerPartitionKey,
                );
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
            this.eventEmitter.emitQueryError(this.id, message);
            this.logAndThrowError(l10n.t('Query failed'), error);
        } else if (error instanceof TimeoutError) {
            this.eventEmitter.emitQueryError(this.id, l10n.t('Query timed out'));
            this.logAndThrowError(l10n.t('Query timed out'), error);
        } else if (error instanceof AbortError || (isObject && 'name' in error && error.name === 'AbortError')) {
            this.eventEmitter.emitQueryError(this.id, l10n.t('Query was aborted'));
            this.logAndThrowError(l10n.t('Query was aborted'), error);
        } else {
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            this.eventEmitter.emitQueryError(this.id, getErrorMessage(error));
            this.logAndThrowError(l10n.t('Query failed'), error);
        }
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

        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.session.getPartitionKey', async (context) => {
            context.errorHandling.rethrow = true;
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

    private logAndThrowError(message: string, error: unknown = undefined): never {
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
        }

        void vscode.window.showErrorMessage(message);
        throw new Error(message);
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
                StatusCodes.BadRequest;

            const retryAfterMs =
                (bulkDeleteResult.response?.headers?.['x-ms-retry-after-ms'] as number) ??
                bulkDeleteResult.error?.retryAfterInMs ??
                300;

            if (statusCode === StatusCodes.NoContent) {
                result.deleted.push(bulkDeleteResult.documentId);
            } else if (statusCode === StatusCodes.TooManyRequests) {
                result.retryAfterMilliseconds = Math.max(retryAfterMs, result.retryAfterMilliseconds);
                result.throttled.push(bulkDeleteResult.documentId);
            } else if (statusCode >= StatusCodes.BadRequest) {
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
