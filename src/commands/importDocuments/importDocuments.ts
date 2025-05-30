/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONObject, type JSONValue, type PartitionKeyDefinition } from '@azure/cosmos';
import { parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { parse as parseJson } from '@prantlf/jsonlint';
import * as l10n from '@vscode/l10n';
import { EJSON, type Document } from 'bson';
import * as fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import * as vscode from 'vscode';
import { getCosmosClient } from '../../cosmosdb/getCosmosClient';
import { validateDocumentId, validatePartitionKey } from '../../cosmosdb/utils/validateDocument';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { createCosmosDbBuffer, createMongoDbBuffer, type DocumentBuffer } from '../../utils/documentBuffer';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { getRootPath } from '../../utils/workspacUtils';

export async function importDocuments(
    context: IActionContext,
    selectedItem: vscode.Uri | CosmosDBContainerResourceItem | CollectionItem | undefined,
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
        selectedItem = await pickAppResource<CosmosDBContainerResourceItem | CollectionItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb, AzExtResourceType.MongoClusters],
            expectedChildContextValue: ['treeItem.container', 'treeItem.collection'],
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
    selectedItem: CosmosDBContainerResourceItem | CollectionItem,
    uris: vscode.Uri[],
): Promise<void> {
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Importing documents…'),
        },
        async (progress) => {
            progress.report({ increment: 0, message: l10n.t('Loading documents…') });

            const countUri = uris.length;
            const incrementUri = 25 / (countUri || 1);
            const documents: unknown[] = [];
            let hasErrors = false;

            for (let i = 0; i < countUri; i++) {
                const increment = (i + 1) * incrementUri;
                progress.report({
                    increment: Math.floor(increment),
                    message: l10n.t('Loading document {num} of {countUri}', { num: i + 1, countUri }),
                });

                const result = await parseAndValidateFile(selectedItem, uris[i]);

                // Note to future maintainers: the validation can return 0 valid documents and still have errors.

                if (result.errors && result.errors.length) {
                    ext.outputChannel.appendLog(
                        l10n.t('Errors found in document {path}. Please fix these.', { path: uris[i].path }),
                    );
                    ext.outputChannel.appendLog(result.errors.join('\n'));
                    ext.outputChannel.show();
                    hasErrors = true;
                }

                if (result.documents && result.documents.length > 0) {
                    documents.push(...result.documents);
                }
            }

            const countDocuments = documents.length ?? 0;
            const incrementDocuments = 75 / (countDocuments || 1);
            let count = 0;
            let buffer: DocumentBuffer<unknown> | undefined;
            if (selectedItem instanceof CollectionItem) {
                buffer = createMongoDbBuffer<unknown>();
            } else if (selectedItem instanceof CosmosDBContainerResourceItem) {
                buffer = createCosmosDbBuffer<unknown>();
            }

            for (let i = 0; i < countDocuments; i++) {
                progress.report({
                    increment: incrementDocuments,
                    message: l10n.t('Importing document {num} of {countDocuments}', {
                        num: i + 1,
                        countDocuments,
                    }),
                });

                const result = await insertDocument(selectedItem, documents[i], buffer);

                // 'count' in result means that the result is from the buffer
                count += result.count;
                // check if error occurred as partial failure would happen in bulk insertion
                hasErrors = hasErrors || result.errorOccurred;
            }

            // Do insertion for the last batch for bulk insertion
            if (buffer && buffer.getStats().documentCount > 0) {
                const lastBatchFlushResult = await insertDocument(selectedItem, undefined, buffer);

                count += lastBatchFlushResult.count;
                hasErrors = hasErrors || lastBatchFlushResult.errorOccurred;
            }

            // let's make sure we reach 100% progress, useful in case of errors etc.
            progress.report({ increment: 100, message: l10n.t('Finished importing') });

            return (
                (hasErrors ? l10n.t('Import has accomplished with errors.') : l10n.t('Import successful.')) +
                ' ' +
                l10n.t('Inserted {0} document(s). See output for more details.', count)
            );
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
    return await context.ui.showOpenDialog(openDialogOptions);
}

async function parseAndValidateFile(
    node: CosmosDBContainerResourceItem | CollectionItem,
    uri: vscode.Uri,
): Promise<{ documents: unknown[]; errors: string[] }> {
    try {
        if (node instanceof CollectionItem) {
            // await needs to catch the error here, otherwise it will be thrown to the caller
            return await parseAndValidateFileForMongo(uri);
        }

        if (node instanceof CosmosDBContainerResourceItem) {
            // await needs to catch the error here, otherwise it will be thrown to the caller
            return await parseAndValidateFileForCosmosDB(uri, node.model.container.partitionKey);
        }
    } catch (e) {
        return { documents: [], errors: [parseError(e).message] };
    }

    return { documents: [], errors: [l10n.t('Unknown error')] };
}

/**
 * @param uri - An array of `vscode.Uri` objects representing the file paths to the JSON documents.
 * EJSON is used to read documents that are supposed to be converted into BSON.
 * EJSON supports more datatypes and is specific to MongoDB. This is currently used for MongoDB clusters/vcore.
 * @returns A promise that resolves to an array of parsed documents as unknown objects.
 */
async function parseAndValidateFileForMongo(uri: vscode.Uri): Promise<{ documents: unknown[]; errors: string[] }> {
    const fileContent = await fs.readFile(uri.fsPath, 'utf8');
    const parsed = EJSON.parse(fileContent) as unknown;
    const errors: string[] = [];
    const documents: unknown[] = [];

    if (!parsed || typeof parsed !== 'object') {
        errors.push(l10n.t('Document must be an object.'));
    } else if (Array.isArray(parsed)) {
        documents.push(
            ...parsed
                .map((document: unknown) => {
                    // Only top-level array is supported
                    if (!document || typeof document !== 'object' || Array.isArray(document)) {
                        errors.push(l10n.t('Document must be an object. Skipping…') + '\n' + EJSON.stringify(document));
                        return undefined;
                    }

                    return document;
                })
                .filter((e) => e),
        );
    } else if (typeof parsed === 'object') {
        documents.push(parsed);
    }

    return { documents, errors };
}

async function parseAndValidateFileForCosmosDB(
    uri: vscode.Uri,
    partitionKey?: PartitionKeyDefinition,
): Promise<{ documents: unknown[]; errors: string[] }> {
    const errors: string[] = [];
    const documents: unknown[] = [];

    const validateOneDocument = (document: JSONObject): boolean => {
        let hasErrors = false;
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
                        errors.push(l10n.t('Document must be an object. Skipping…') + '\n' + EJSON.stringify(document));
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

async function insertDocument(
    node: CosmosDBContainerResourceItem | CollectionItem,
    document: unknown,
    buffer: DocumentBuffer<unknown> | undefined,
): Promise<{ count: number; errorOccurred: boolean }> {
    try {
        // Check for valid buffer
        if (!buffer) {
            return { count: 0, errorOccurred: true };
        }

        // Route to appropriate handler based on node type
        if (node instanceof CollectionItem) {
            return await insertDocumentWithBufferIntoCluster(node, buffer, document as Document);
        } else if (node instanceof CosmosDBContainerResourceItem) {
            return await insertDocumentWithBufferIntoCosmosDB(node, buffer, document as ItemDefinition);
        }

        // Should only reach here if node is neither CollectionItem nor CosmosDBContainerResourceItem
        return { count: 0, errorOccurred: true };
    } catch {
        return { count: 0, errorOccurred: true };
    }
}

async function insertDocumentWithBufferIntoCluster(
    node: CollectionItem,
    buffer: DocumentBuffer<unknown>,
    document?: Document,
    // If document is undefined, it means that we are flushing the buffer
    // It is used for the last batch, and not recommended to be used for normal batches
): Promise<{ count: number; errorOccurred: boolean }> {
    const databaseName = node.databaseInfo.name;
    const collectionName = node.collectionInfo.name;
    // Try to add document to buffer
    const insertToBufferResult = buffer.insert(document);
    // If successful, no immediate action needed
    if (insertToBufferResult.success) {
        return { count: 0, errorOccurred: false };
    }

    let documentsToProcess: Document[];
    if (insertToBufferResult.documentsToProcess) {
        if (!Array.isArray(insertToBufferResult.documentsToProcess)) {
            // If the documentsToProcess is not an array, it means that the document was too large
            documentsToProcess = [insertToBufferResult.documentsToProcess as Document];
        } else {
            // If the documentsToProcess is an array, it means that the buffer was full
            // and we need to process the contents of the buffer
            documentsToProcess = insertToBufferResult.documentsToProcess as Document[];
            // Insert current document into the buffer
            buffer.insert(document);
        }
    } else {
        // In this case, we are flushing the buffer
        documentsToProcess = buffer.flush() as Document[];
    }

    // Documents to process could be the current document (if too large)
    // or the contents of the buffer (if it was full)
    const client = await ClustersClient.getClient(node.cluster.id);
    const insertResult = await client.insertDocuments(databaseName, collectionName, documentsToProcess);

    return {
        count: insertResult.insertedCount,
        errorOccurred: insertResult.insertedCount < (documentsToProcess?.length || 0),
    };
}

async function insertDocumentWithBufferIntoCosmosDB(
    node: CosmosDBContainerResourceItem,
    buffer: DocumentBuffer<unknown>,
    document?: ItemDefinition,
    // If document is undefined, it means that we are flushing the buffer
): Promise<{ count: number; errorOccurred: boolean }> {
    const databaseName = node.model.database.id;
    const containerName = node.model.container.id;

    // Try to add document to buffer
    const insertToBufferResult = buffer.insert(document);
    // If successful, no immediate action needed
    if (insertToBufferResult.success) {
        return { count: 0, errorOccurred: false };
    }

    let documentsToProcess: ItemDefinition[];
    if (insertToBufferResult.documentsToProcess) {
        if (!Array.isArray(insertToBufferResult.documentsToProcess)) {
            // If the documentsToProcess is not an array, it means that the document was too large
            documentsToProcess = [insertToBufferResult.documentsToProcess as ItemDefinition];
        } else {
            // If the documentsToProcess is an array, it means that the buffer was full
            // and we need to process the contents of the buffer
            documentsToProcess = insertToBufferResult.documentsToProcess as ItemDefinition[];
            // Insert current document into the buffer
            buffer.insert(document);
        }
    } else {
        // In this case, we are flushing the buffer
        documentsToProcess = buffer.flush() as ItemDefinition[];
    }

    // Documents to process could be the current document (if too large)
    // or the contents of the buffer (if it was full)
    const { endpoint, credentials, isEmulator } = node.model.accountInfo;
    const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
    const container = cosmosClient.database(databaseName).container(containerName);

    const bulkOperations = documentsToProcess.map((doc) => {
        return {
            operationType: 'Create' as const,
            resourceBody: {
                ...doc,
                // Ensure id is set, if not provided, generate a new UUID
                // This is important for CosmosDB bulk operations as it requires an id field
                id: doc.id ?? uuidv4(),
            },
        };
    });

    try {
        const response = await container.items.bulk(bulkOperations);

        // Count successful operations
        const successCount = response.filter((op) => op.statusCode >= 200 && op.statusCode < 300).length;
        const errorOccurred = successCount < bulkOperations.length;

        if (errorOccurred) {
            // Log errors to output channel
            response.forEach((op) => {
                if (op.statusCode >= 300) {
                    ext.outputChannel.appendLog(l10n.t('The insertion failed with status code {0}', op.statusCode));
                }
            });
            ext.outputChannel.show();
        }

        return {
            count: successCount,
            errorOccurred,
        };
    } catch (error) {
        ext.outputChannel.appendLog(l10n.t('The insertion failed with error: {0}', parseError(error).message));
        ext.outputChannel.show();
        return {
            count: 0,
            errorOccurred: true,
        };
    }
}
