/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    BulkOperationType,
    StatusCodes,
    type ItemDefinition,
    type JSONObject,
    type JSONValue,
    type PartitionKeyDefinition,
} from '@azure/cosmos';
import { parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { parse as parseJson } from '@prantlf/jsonlint';
import * as l10n from '@vscode/l10n';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { validateDocumentId, validatePartitionKey } from '../../cosmosdb/utils/validateDocument';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { extractPartitionKey } from '../../utils/document';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { getRootPath } from '../../utils/workspacUtils';

export async function importDocuments(
    context: IActionContext,
    selectedItem: vscode.Uri | CosmosDBContainerResourceItem | undefined,
    uris: vscode.Uri[] | undefined,
): Promise<void> {
    if (selectedItem instanceof vscode.Uri) {
        uris ||= [selectedItem];
        selectedItem = undefined;
    } else {
        uris ||= [];
    }

    if (!uris || uris.length === 0) {
        uris = await askForDocuments(context);
    }

    const ignoredUris: vscode.Uri[] = []; //account for https://github.com/Microsoft/vscode/issues/59782
    uris = uris.filter((uri) => {
        if (uri.fsPath.toLocaleLowerCase().endsWith('.json')) {
            return true;
        } else {
            ignoredUris.push(uri);
            return false;
        }
    });

    if (ignoredUris.length) {
        ext.outputChannel.appendLog(
            l10n.t('Ignoring the following files that do not match the "*.json" file name pattern:'),
        );
        ignoredUris.forEach((uri) => ext.outputChannel.appendLog(`${uri.fsPath}`));
        ext.outputChannel.show();
    }

    if (!selectedItem) {
        selectedItem = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
    }

    if (!selectedItem) {
        return undefined;
    }

    context.telemetry.properties.experience = selectedItem.experience.api;

    await ext.state.runWithTemporaryDescription(selectedItem.id, l10n.t('Importing…'), async () => {
        await importDocumentsWithProgress(selectedItem, uris);
    });

    ext.state.notifyChildrenChanged(selectedItem.id);
}

export async function importDocumentsWithProgress(
    selectedItem: CosmosDBContainerResourceItem,
    uris: vscode.Uri[],
): Promise<void> {
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Importing documents…'),
            cancellable: true,
        },
        async (progress, token) => {
            progress.report({ increment: 0, message: l10n.t('Loading documents…') });

            const countUri = uris.length;
            const incrementUri = 50 / (countUri || 1);
            const documents: unknown[] = [];
            let hasErrors = false;

            for (let i = 0, percent = 0; i < countUri; i++, percent += incrementUri) {
                progress.report({
                    increment: Math.floor(percent),
                    message: l10n.t('Loading document {num} of {countUri}', { num: i + 1, countUri }),
                });

                const result = await parseAndValidateFile(selectedItem, uris[i]);

                if (result.errors && result.errors.length) {
                    ext.outputChannel.appendLog(
                        l10n.t('Errors found in document {path}. Please fix these.', { path: uris[i].path }),
                    );
                    ext.outputChannel.appendLog(result.errors.join('\n'));
                    ext.outputChannel.show();
                    hasErrors = true;
                }

                if (result.documents && result.documents.length) {
                    documents.push(...result.documents);
                }
            }

            const bulkResult = await bulkInsertDocuments(selectedItem, documents as ItemDefinition[], progress, token);
            const count = bulkResult.numSucceeded;

            if (bulkResult.errors.length > 0) {
                bulkResult.errors.forEach((error) => ext.outputChannel.appendLog(error));
                ext.outputChannel.show();
                hasErrors = true;
            }

            progress.report({ increment: 50, message: l10n.t('Finished importing') });

            return hasErrors
                ? l10n.t('Import has accomplished with errors.')
                : l10n.t('Import successful.') +
                      ' ' +
                      l10n.t('Inserted {0} document(s). See output for more details.', count);
        },
    );

    // We should not use await here, otherwise the node status will not be updated until the message is closed
    vscode.window.showInformationMessage(result);
}

async function askForDocuments(context: IActionContext): Promise<vscode.Uri[]> {
    const openDialogOptions: vscode.OpenDialogOptions = {
        canSelectMany: true,
        openLabel: l10n.t('Import'),
        filters: {
            JSON: ['json'],
        },
    };
    const rootPath: string | undefined = getRootPath();
    if (rootPath) {
        openDialogOptions.defaultUri = vscode.Uri.file(rootPath);
    }
    return context.ui.showOpenDialog(openDialogOptions);
}

async function parseAndValidateFile(
    node: CosmosDBContainerResourceItem,
    uri: vscode.Uri,
): Promise<{ documents: unknown[]; errors: string[] }> {
    try {
        // await needs to catch the error here, otherwise it will be thrown to the caller
        return await parseAndValidateFileForCosmosDB(uri, node.model.container.partitionKey);
    } catch (e) {
        return { documents: [], errors: [parseError(e).message] };
    }
}

async function parseAndValidateFileForCosmosDB(
    uri: vscode.Uri,
    partitionKey?: PartitionKeyDefinition,
): Promise<{ documents: unknown[]; errors: string[] }> {
    const errors: string[] = [];
    const documents: unknown[] = [];

    const validateOneDocument = (document: JSONObject): boolean => {
        let hasErrors = false;
        // TODO: make partition key validation optional for import in UI with a prompt and set `allowNullOrUndefined` accordingly?
        const partitionKeyError = validatePartitionKey(document, partitionKey);
        if (partitionKeyError) {
            errors.push(...partitionKeyError);
            hasErrors = true;
        }

        const idError = validateDocumentId(document);
        if (idError) {
            errors.push(...idError);
            hasErrors = true;
        }

        return !hasErrors;
    };

    const fileContent = await fs.readFile(uri.fsPath, 'utf8');
    const parsed = parseJson(fileContent) as JSONValue;

    if (!parsed || typeof parsed !== 'object') {
        errors.push(l10n.t('Document must be an object.'));
    } else if (Array.isArray(parsed)) {
        documents.push(
            ...parsed
                .map((document: unknown) => {
                    // Only top-level array is supported
                    if (!document || typeof document !== 'object' || Array.isArray(document)) {
                        errors.push(l10n.t('Document must be an object. Skipping…') + '\n' + JSON.stringify(document));
                        return undefined;
                    }

                    return validateOneDocument(document as JSONObject) ? document : undefined;
                })
                .filter((e) => e),
        );
    } else if (typeof parsed === 'object') {
        if (validateOneDocument(parsed as JSONObject)) {
            documents.push(parsed);
        }
    }

    return { documents, errors };
}

const BULK_INSERT_CHUNK_SIZE = 100;
const BULK_INSERT_MAX_RETRIES = 10;

type BulkInsertResult = {
    numSucceeded: number;
    numFailed: number;
    errors: string[];
};

function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

/**
 * Executes a single bulk-create call and categorises the per-document results.
 */
async function executeBulkChunk(
    node: CosmosDBContainerResourceItem,
    documents: ItemDefinition[],
    partitionKeyDefinition: PartitionKeyDefinition | undefined,
): Promise<{
    succeeded: ItemDefinition[];
    throttled: ItemDefinition[];
    failed: ItemDefinition[];
    retryAfterMs: number;
}> {
    const responses = await withClaimsChallengeHandling(node.model.accountInfo, (cosmosClient) =>
        cosmosClient
            .database(node.model.database.id)
            .container(node.model.container.id)
            .items.executeBulkOperations(
                documents.map((doc) => ({
                    operationType: BulkOperationType.Create,
                    resourceBody: doc as JSONObject,
                    partitionKey: partitionKeyDefinition ? extractPartitionKey(doc, partitionKeyDefinition) : undefined,
                })),
            ),
    );

    let retryAfterMs = 0;
    const succeeded: ItemDefinition[] = [];
    const throttled: ItemDefinition[] = [];
    const failed: ItemDefinition[] = [];

    responses.forEach((response, index) => {
        const statusCode =
            response.response?.statusCode ??
            (typeof response?.error?.code === 'number' ? response?.error?.code : null) ??
            StatusCodes.BadRequest;

        if (statusCode === StatusCodes.Created) {
            succeeded.push(documents[index]);
        } else if (statusCode === StatusCodes.TooManyRequests) {
            throttled.push(documents[index]);
            retryAfterMs = Math.max(
                retryAfterMs,
                (response.response?.headers?.['x-ms-retry-after-ms'] as number) ??
                    response.error?.retryAfterInMs ??
                    300,
            );
        } else {
            failed.push(documents[index]);
        }
    });

    return { succeeded, throttled, failed, retryAfterMs };
}

/**
 * Sends a chunk via `executeBulkOperations`, retrying throttled documents up to
 * {@link BULK_INSERT_MAX_RETRIES} times. Returns the number of documents that
 * succeeded and any that could not be inserted (to be retried one-by-one).
 */
async function executeBulkChunkWithRetries(
    node: CosmosDBContainerResourceItem,
    chunk: ItemDefinition[],
    partitionKeyDefinition: PartitionKeyDefinition | undefined,
    token: vscode.CancellationToken,
): Promise<{ succeeded: ItemDefinition[]; failed: ItemDefinition[] }> {
    let documentsToAttempt = [...chunk];
    const succeeded: ItemDefinition[] = [];
    const failed: ItemDefinition[] = [];

    for (let attempt = 0; attempt < BULK_INSERT_MAX_RETRIES && documentsToAttempt.length > 0; attempt++) {
        if (token.isCancellationRequested) {
            failed.push(...documentsToAttempt);
            break;
        }

        try {
            const result = await executeBulkChunk(node, documentsToAttempt, partitionKeyDefinition);

            succeeded.push(...result.succeeded);
            failed.push(...result.failed);
            documentsToAttempt = result.throttled;

            if (documentsToAttempt.length > 0) {
                const waitMs = Math.max(result.retryAfterMs, (attempt + 1) * 1000);
                ext.outputChannel.appendLog(
                    l10n.t(
                        '{0} document creations were throttled. Waiting {1}ms and retrying…',
                        documentsToAttempt.length,
                        waitMs,
                    ),
                );
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        } catch {
            // Entire bulk operation failed (e.g. emulator does not support executeBulkOperations).
            failed.push(...documentsToAttempt);
            documentsToAttempt = [];
        }
    }

    // Throttle retries exhausted
    failed.push(...documentsToAttempt);
    return { succeeded, failed };
}

/**
 * Imports documents in two phases:
 * 1. Bulk-insert via `executeBulkOperations` (chunked, with throttle-retry).
 * 2. Retry every document that failed in phase 1 one-by-one.
 */
async function bulkInsertDocuments(
    node: CosmosDBContainerResourceItem,
    documents: ItemDefinition[],
    progress: vscode.Progress<{ increment?: number; message?: string }>,
    token: vscode.CancellationToken,
): Promise<BulkInsertResult> {
    const stats: BulkInsertResult = { numSucceeded: 0, numFailed: 0, errors: [] };
    const partitionKeyDefinition = node.model.container.partitionKey;
    const documentsToRetry: ItemDefinition[] = [];

    // Auto-generate UUIDs for documents missing an `id` (required by the SDK).
    const prepared = documents.map((doc) => (doc.id ? doc : { ...doc, id: globalThis.crypto.randomUUID() }));
    const chunks = chunkArray(prepared, BULK_INSERT_CHUNK_SIZE);
    const incrementPerChunk = 40 / (chunks.length || 1);

    // --- Phase 1: Bulk insert via executeBulkOperations ---
    for (let i = 0; i < chunks.length; i++) {
        if (token.isCancellationRequested) {
            break;
        }

        progress.report({
            increment: Math.floor(incrementPerChunk),
            message: l10n.t('Importing chunk {num} of {total} ({count} documents)', {
                num: i + 1,
                total: chunks.length,
                count: chunks[i].length,
            }),
        });

        const { succeeded, failed } = await executeBulkChunkWithRetries(node, chunks[i], partitionKeyDefinition, token);

        stats.numSucceeded += succeeded.length;
        documentsToRetry.push(...failed);
    }

    // --- Phase 2: Retry all failed documents one-by-one ---
    if (documentsToRetry.length > 0) {
        ext.outputChannel.appendLog(l10n.t('Retrying {0} document(s) one by one…', documentsToRetry.length));

        const incrementPerDoc = 10 / (documentsToRetry.length || 1);

        for (let i = 0; i < documentsToRetry.length; i++) {
            if (token.isCancellationRequested) {
                stats.numFailed += documentsToRetry.length - i;
                ext.outputChannel.appendLog(
                    l10n.t('Import cancelled. {0} document(s) were not inserted.', documentsToRetry.length - i),
                );
                break;
            }

            progress.report({
                increment: Math.floor(incrementPerDoc),
                message: l10n.t('Retrying document {num} of {total}', { num: i + 1, total: documentsToRetry.length }),
            });

            const result = await insertDocument(node, documentsToRetry[i]);

            if (result.error) {
                stats.numFailed++;
                stats.errors.push(result.error);
            } else {
                stats.numSucceeded++;
            }
        }
    }

    return stats;
}

async function insertDocument(
    node: CosmosDBContainerResourceItem,
    document: unknown,
): Promise<{ document: unknown; error: string }> {
    try {
        // await needs to catch the error here, otherwise it will be thrown to the caller
        return await insertDocumentIntoCosmosDB(node, document as ItemDefinition);
    } catch (e) {
        return { document, error: parseError(e).message };
    }
}

async function insertDocumentIntoCosmosDB(
    node: CosmosDBContainerResourceItem,
    document: ItemDefinition,
): Promise<{ document: ItemDefinition; error: string }> {
    const response = await withClaimsChallengeHandling(node.model.accountInfo, (cosmosClient) => {
        return cosmosClient
            .database(node.model.database.id)
            .container(node.model.container.id)
            .items.create<ItemDefinition>(document);
    });

    if (response.resource) {
        return { document, error: '' };
    } else {
        return { document, error: l10n.t('The insertion failed with status code {0}', response.statusCode) };
    }
}
