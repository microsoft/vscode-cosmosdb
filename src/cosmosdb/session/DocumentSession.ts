/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    BulkOperationType,
    StatusCodes,
    type BulkOperationResult,
    type Container,
    type DeleteOperationInput,
    type ItemDefinition,
    type JSONObject,
    type PartitionKey,
    type PartitionKeyDefinition,
} from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { ext } from '../../extensionVariables';
import { extractPartitionKey } from '../../utils/document';
import { getCosmosDBKeyCredential } from '../CosmosDBCredential';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';
import { type CosmosDBRecord, type CosmosDBRecordIdentifier } from '../types/queryResult';
import { withClaimsChallengeHandling } from '../withClaimsChallengeHandling';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Result of a document operation that returns document content.
 */
export type DocumentResult = {
    documentContent: CosmosDBRecord;
    partitionKey?: PartitionKeyDefinition;
};

/**
 * Result of a create or update operation that returns both the document and its identifier.
 */
export type DocumentWriteResult = DocumentResult & {
    identifier: CosmosDBRecordIdentifier;
};

export type DeleteStatus = {
    valid: DocumentId[];
    invalid: CosmosDBRecordIdentifier[];
    deleted: DocumentId[];
    throttled: DocumentId[];
    failed: DocumentId[];
    aborted: boolean;
};

export type DocumentId = CosmosDBRecordIdentifier & { id: string };

export const isDocumentId = (documentId: CosmosDBRecordIdentifier): documentId is DocumentId => {
    return documentId.id !== undefined && documentId.id !== '';
};

// ─── Container access ───────────────────────────────────────────────────────

/**
 * Execute an operation against the container with claims challenge handling.
 */
export async function withContainer<T>(
    connection: NoSqlQueryConnection,
    operation: (container: Container) => Promise<T>,
): Promise<T> {
    return withClaimsChallengeHandling(connection, async (client) => {
        const container = client.database(connection.databaseId).container(connection.containerId);
        return operation(container);
    });
}

// ─── Partition key helpers ──────────────────────────────────────────────────

/**
 * Get the partition key definition for the container.
 * If a known definition is provided, it is returned immediately.
 * Otherwise, the definition is fetched from the container.
 */
export async function getPartitionKey(
    connection: NoSqlQueryConnection,
    known?: PartitionKeyDefinition,
): Promise<PartitionKeyDefinition | undefined> {
    if (known) {
        return known;
    }

    return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.getPartitionKey', async (context) => {
        context.errorHandling.rethrow = true;

        const containerDef = await withContainer(connection, (c) => c.read());

        if (containerDef.resource === undefined) {
            throw new Error(l10n.t('Container {0} not found', connection.containerId));
        }

        return containerDef.resource.partitionKey;
    });
}

/**
 * Extract partition key value from a document.
 */
export async function extractPartitionKeyFromDocument(
    connection: NoSqlQueryConnection,
    document: ItemDefinition,
    partitionKeyDefinition?: PartitionKeyDefinition,
): Promise<PartitionKey | undefined> {
    const pk = await getPartitionKey(connection, partitionKeyDefinition);
    if (!pk) return undefined;
    return extractPartitionKey(document, pk);
}

/**
 * Build a new document template with placeholder values.
 */
export async function buildNewDocumentTemplate(
    connection: NoSqlQueryConnection,
    partitionKeyDefinition?: PartitionKeyDefinition,
): Promise<DocumentResult | undefined> {
    const containerPartitionKey = await getPartitionKey(connection, partitionKeyDefinition);

    const newDocument: JSONObject = { id: 'replace_with_new_document_id' };
    containerPartitionKey?.paths.forEach((partitionKeyProperty) => {
        let target = newDocument;
        const keySegments = partitionKeyProperty.split('/').filter((segment) => segment.length > 0);
        const finalSegment = keySegments.pop();
        if (!finalSegment) return;

        keySegments.forEach((segment) => {
            target[segment] ??= {};
            target = target[segment] as JSONObject;
        });
        target[finalSegment] = 'replace_with_new_partition_key_value';
    });

    return {
        documentContent: newDocument as unknown as CosmosDBRecord,
        partitionKey: containerPartitionKey,
    };
}

// ─── Telemetry ──────────────────────────────────────────────────────────────

/**
 * Set telemetry properties for masking and identification of document operations.
 */
export function setDocumentTelemetryProperties(context: IActionContext, connection: NoSqlQueryConnection): void {
    const masterKey = getCosmosDBKeyCredential(connection.credentials)?.key ?? '';
    context.valuesToMask.push(masterKey, connection.endpoint, connection.databaseId, connection.containerId);
    context.errorHandling.suppressDisplay = true;
    context.errorHandling.suppressReportIssue = true;
    context.telemetry.properties.databaseId = crypto.createHash('sha256').update(connection.databaseId).digest('hex');
    context.telemetry.properties.containerId = crypto.createHash('sha256').update(connection.containerId).digest('hex');
}

// ─── Standalone utility functions for document operations ───────────────────
// These are used by routers/controllers that own the CRUD logic.

/**
 * Read a document by id with fallback to _rid query.
 */
export async function readDocument(
    connection: NoSqlQueryConnection,
    documentId: CosmosDBRecordIdentifier,
    signal?: AbortSignal,
    partitionKeyDefinition?: PartitionKeyDefinition,
): Promise<DocumentResult | undefined> {
    return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.read', async (context) => {
        context.errorHandling.rethrow = true;
        setDocumentTelemetryProperties(context, connection);

        if (documentId.id === undefined || documentId._rid === undefined) {
            throw new Error(l10n.t('Item id or _rid is required'));
        }

        const result = await readWithFallback(connection, documentId, signal);
        if (!result) {
            throw new Error(l10n.t('Item not found or request timed out'));
        }

        const partitionKey = await getPartitionKey(connection, partitionKeyDefinition);
        return { documentContent: result, partitionKey };
    });
}

/**
 * Create a new document.
 */
export async function createDocument(
    connection: NoSqlQueryConnection,
    document: ItemDefinition,
    signal?: AbortSignal,
    partitionKeyDefinition?: PartitionKeyDefinition,
): Promise<DocumentWriteResult | undefined> {
    return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.create', async (context) => {
        context.errorHandling.rethrow = true;
        setDocumentTelemetryProperties(context, connection);

        const response = await withContainer(connection, (container) =>
            container.items.create<ItemDefinition>(document, { abortSignal: signal }),
        );

        if (!response?.resource) {
            throw new Error(l10n.t('Item creation failed'));
        }

        const record = response.resource as CosmosDBRecord;
        const containerPartitionKey = await getPartitionKey(connection, partitionKeyDefinition);
        const partitionKeyValue = containerPartitionKey
            ? extractPartitionKey(record, containerPartitionKey)
            : undefined;

        return {
            documentContent: record,
            partitionKey: containerPartitionKey,
            identifier: { id: record.id, _rid: record._rid, partitionKey: partitionKeyValue },
        };
    });
}

/**
 * Replace (update) an existing document.
 */
export async function replaceDocument(
    connection: NoSqlQueryConnection,
    document: ItemDefinition,
    documentId: CosmosDBRecordIdentifier,
    signal?: AbortSignal,
    partitionKeyDefinition?: PartitionKeyDefinition,
): Promise<DocumentWriteResult | undefined> {
    return callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.update', async (context) => {
        context.errorHandling.rethrow = true;
        setDocumentTelemetryProperties(context, connection);

        if (documentId.id === undefined) {
            throw new Error(l10n.t('Item id is required'));
        }

        const response = await withContainer(connection, (container) =>
            container.item(documentId.id!, documentId.partitionKey).replace(document, {
                abortSignal: signal,
            }),
        );

        if (!response?.resource) {
            throw new Error(l10n.t('Item update failed'));
        }

        const record = response.resource as CosmosDBRecord;
        const containerPartitionKey = await getPartitionKey(connection, partitionKeyDefinition);

        return {
            documentContent: record,
            partitionKey: containerPartitionKey,
            identifier: {
                id: record.id,
                _rid: record._rid,
                partitionKey: containerPartitionKey ? extractPartitionKey(record, containerPartitionKey) : undefined,
            },
        };
    });
}

/**
 * Delete a document by its identifier.
 */
export async function deleteDocument(
    connection: NoSqlQueryConnection,
    documentId: CosmosDBRecordIdentifier,
    signal?: AbortSignal,
): Promise<boolean> {
    const result = await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.delete', async (context) => {
        context.errorHandling.rethrow = true;
        setDocumentTelemetryProperties(context, connection);

        if (documentId.id === undefined) {
            throw new Error(l10n.t('Item id is required'));
        }

        const response = await withContainer(connection, (container) =>
            container.item(documentId.id!, documentId.partitionKey).delete({
                abortSignal: signal,
            }),
        );

        if (response?.statusCode !== 204) {
            throw new Error(l10n.t('Item deletion failed'));
        }

        return true;
    });

    return result ?? false;
}

/**
 * Bulk delete documents with batching, retry, and progress reporting.
 */
export async function bulkDeleteDocuments(
    connection: NoSqlQueryConnection,
    documentIds: CosmosDBRecordIdentifier[],
): Promise<DeleteStatus> {
    const status: DeleteStatus = {
        valid: documentIds.filter((d) => isDocumentId(d)),
        invalid: documentIds.filter((d) => !isDocumentId(d)),
        deleted: [],
        throttled: [],
        failed: [],
        aborted: false,
    };

    if (status.valid.length === 0) return status;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: l10n.t('Deleting documents'), cancellable: true },
        async (progress, token) => {
            const abortController = new AbortController();
            token.onCancellationRequested(() => {
                status.aborted = true;
                abortController.abort();
            });

            let processedIds = Array.from(status.valid);
            let retryMs = 0;

            while (processedIds.length > 0 && !abortController.signal.aborted) {
                if (retryMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, retryMs));
                    processedIds = Array.from(status.throttled);
                    status.throttled = [];
                }

                progress.report({ message: formatDeleteProgress(status) });

                const result = await processBulkDeleteBatch(connection, processedIds, abortController.signal);
                retryMs = result.retryAfterMilliseconds;
                status.deleted.push(...result.deleted);
                status.throttled.push(...result.throttled);
                status.failed.push(...result.failed);
            }
        },
    );

    return status;
}

// ─── Private helpers ────────────────────────────────────────────────────────

async function readWithFallback(
    connection: NoSqlQueryConnection,
    documentId: CosmosDBRecordIdentifier,
    signal?: AbortSignal,
): Promise<CosmosDBRecord | undefined> {
    const timeoutMs = 4000;

    let result: CosmosDBRecord | undefined;
    try {
        const readPromise = withContainer(connection, (container) =>
            container.item(documentId.id!, documentId.partitionKey).read<CosmosDBRecord>({
                abortSignal: signal,
            }),
        );
        const response = await Promise.race([readPromise, rejectAfter(timeoutMs, 'Read operation timed out')]);
        result = response?.resource;
    } catch (err) {
        ext.outputChannel.error(
            `[document.read] Primary read failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    if (!result && documentId._rid) {
        const rid = documentId._rid;
        try {
            const queryPromise = withContainer(connection, (container) =>
                container.items
                    .query<CosmosDBRecord>(
                        { query: 'SELECT * FROM c WHERE c._rid = @rid', parameters: [{ name: '@rid', value: rid }] },
                        { abortSignal: signal, bufferItems: true },
                    )
                    .fetchAll(),
            );
            const queryResult = await Promise.race([
                queryPromise,
                rejectAfter(timeoutMs, 'Fallback read operation timed out'),
            ]);

            if (queryResult?.resources?.length === 1) {
                result = queryResult.resources[0];
                ext.outputChannel.appendLog(`[document.read] Document found via _rid query`);
            } else {
                ext.outputChannel.appendLog(
                    `[document.read] _rid query returned ${queryResult.resources?.length ?? 0} results`,
                );
            }
        } catch (err) {
            ext.outputChannel.error(
                `[document.read] Fallback read failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    return result;
}

function rejectAfter(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

function formatDeleteProgress(status: DeleteStatus): string {
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

async function processBulkDeleteBatch(connection: NoSqlQueryConnection, ids: DocumentId[], abortSignal: AbortSignal) {
    const result = {
        deleted: [] as DocumentId[],
        throttled: [] as DocumentId[],
        failed: [] as DocumentId[],
        retryAfterMilliseconds: 0,
    };
    const BULK_DELETE_LIMIT = 100;

    ext.outputChannel.appendLog(l10n.t('Deleting {count} document(s)', { count: ids.length }));

    const promiseArray = await withContainer(connection, async (container) => {
        const promises: Promise<Array<BulkOperationResult & { documentId: DocumentId }>>[] = [];
        while (ids.length > 0 && !abortSignal.aborted) {
            const chunk = ids.splice(0, BULK_DELETE_LIMIT);
            const operations = chunk.map(
                (d): DeleteOperationInput => ({
                    id: d.id,
                    partitionKey:
                        Array.isArray(d.partitionKey) && d.partitionKey.length === 0 ? undefined : d.partitionKey,
                    operationType: BulkOperationType.Delete,
                }),
            );
            promises.push(
                container.items
                    .executeBulkOperations(operations, { abortSignal })
                    .then((results) => results.map((r, i) => ({ ...r, documentId: chunk[i] }))),
            );
        }
        return promises;
    });

    const deleteResults = (await Promise.all(promiseArray)).flat();

    deleteResults.forEach((r) => {
        const code =
            r.response?.statusCode ??
            (typeof r?.error?.code === 'number' ? r.error.code : null) ??
            StatusCodes.BadRequest;
        const retryMs = (r.response?.headers?.['x-ms-retry-after-ms'] as number) ?? r.error?.retryAfterInMs ?? 300;

        if (code === StatusCodes.NoContent) {
            result.deleted.push(r.documentId);
        } else if (code === StatusCodes.TooManyRequests) {
            result.retryAfterMilliseconds = Math.max(retryMs, result.retryAfterMilliseconds);
            result.throttled.push(r.documentId);
        } else if (code >= StatusCodes.BadRequest) {
            ext.outputChannel.appendLog(
                l10n.t('Failed to delete document {id} with status code {statusCode}. Error: {error}', {
                    id: r.documentId.id,
                    statusCode: code,
                    error: r.error?.body?.message ?? l10n.t('Unknown error'),
                }),
            );
            result.failed.push(r.documentId);
        }
    });

    ext.outputChannel.appendLog(l10n.t('Successfully deleted {count} document(s)', { count: result.deleted.length }));
    if (result.throttled.length > 0) {
        ext.outputChannel.appendLog(
            l10n.t('Failed to delete {count} document(s) due to "Request too large" (429) error. Retrying...', {
                count: result.throttled.length,
            }),
        );
    }

    return result;
}
