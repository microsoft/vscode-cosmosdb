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
import * as fse from 'fs-extra';
import * as vscode from 'vscode';
import { getCosmosClient } from '../../cosmosdb/getCosmosClient';
import { validateDocumentId, validatePartitionKey } from '../../cosmosdb/utils/validateDocument';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { getRootPath } from '../../utils/workspacUtils';

export class DocumentBufferforMongo {
    private documents: Document[] = [];
    private totalSize: number = 0;
    private readonly node: CollectionItem;
    private maxBatchSize: number = 50;
    private maxDocumentSize: number = 16 * 1024 * 1024;
    private maxTotalSize: number = 32 * 1024 * 1024;

    constructor(node: CollectionItem) {
        this.node = node;
    }

    public async addDocument(
        document: Document,
    ): Promise<{ count: number; error: Array<{ index: number; errmsg: string }> | string | undefined } | undefined> {
        const docSize = this.estimateDocumentSize(document);

        if (docSize > this.maxDocumentSize) {
            return await this.insertSingleDocument(document);
        }

        let flushResponse: { count: number; error: Array<{ index: number; errmsg: string }> | undefined } | undefined;
        if (this.documents.length >= this.maxBatchSize || this.totalSize + docSize > this.maxTotalSize) {
            flushResponse = await this.flush();
        }

        this.documents.push(document);
        this.totalSize += docSize;
        return flushResponse;
    }

    private estimateDocumentSize(document: Document): number {
        return Buffer.from(JSON.stringify(document)).length * 1.2;
    }

    public async flush(): Promise<{
        count: number;
        error: Array<{ index: number; errmsg: string }> | undefined;
    }> {
        if (this.documents.length === 0) {
            return { count: 0, error: undefined };
        }

        const documentsToInsert = [...this.documents];
        this.documents = [];
        this.totalSize = 0;

        return await this.insertBatch(documentsToInsert);
    }

    private async insertBatch(
        documents: Document[],
    ): Promise<{ count: number; error: Array<{ index: number; errmsg: string }> | undefined }> {
        const client = await ClustersClient.getClient(this.node.cluster.id);
        const response = await client.insertDocuments(
            this.node.databaseInfo.name,
            this.node.collectionInfo.name,
            documents,
        );

        if (!response.errorsOccured) {
            return { count: response.insertedCount, error: undefined };
        } else if (response.writeErrors) {
            return { count: response.insertedCount, error: response.writeErrors };
        } else {
            return {
                count: response.insertedCount,
                error: [{ index: -1 * documents.length, errmsg: response?.errorMessage ?? l10n.t('Unknown error') }],
            };
        }
    }

    private async insertSingleDocument(document: Document): Promise<{ count: number; error: string | undefined }> {
        const client = await ClustersClient.getClient(this.node.cluster.id);
        const response = await client.insertDocuments(this.node.databaseInfo.name, this.node.collectionInfo.name, [
            document,
        ]);

        if (!response.errorsOccured) {
            return { count: response.insertedCount, error: undefined };
        } else {
            return { count: 0, error: response?.errorMessage ?? l10n.t('Unknown error') };
        }
    }
}

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

            const countDocuments = documents.length;
            const incrementDocuments = 50 / (countDocuments || 1);
            let count = 0;
            let buffer: DocumentBufferforMongo | undefined;
            if (selectedItem instanceof CollectionItem) {
                buffer = new DocumentBufferforMongo(selectedItem);
            }

            for (let i = 0, percent = 0; i < countDocuments; i++, percent += incrementDocuments) {
                progress.report({
                    increment: Math.floor(percent),
                    message: l10n.t('Importing document {num} of {countDocuments}', {
                        num: i + 1,
                        countDocuments,
                    }),
                });

                if (selectedItem instanceof CosmosDBContainerResourceItem) {
                    const result = await insertDocument(selectedItem, documents[i]);
                    if (result.error) {
                        ext.outputChannel.appendLog(
                            l10n.t('The insertion of document {number} failed with error: {error}', {
                                number: i + 1,
                                error: result.error,
                            }),
                        );
                        ext.outputChannel.show();
                        hasErrors = true;
                    } else {
                        count++;
                    }
                } else if (selectedItem instanceof CollectionItem) {
                    const result = await insertDocumentWithBuffer(documents[i] as Document, buffer!);
                    const parsedResult = handleInsertionResultForMongo(result, i, hasErrors);
                    count += parsedResult.insertedCount;
                    hasErrors = parsedResult.hasError;
                }
                // Do not need default case here, because the caller should check the type of selectedItem
            }

            if (buffer) {
                const result = await buffer.flush();
                const parsedResult = handleInsertionResultForMongo(result, countDocuments, hasErrors);
                count += parsedResult.insertedCount;
                hasErrors = parsedResult.hasError;
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
    const fileContent = await fse.readFile(uri.fsPath, 'utf8');
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

    const fileContent = await fse.readFile(uri.fsPath, 'utf8');
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
    node: CosmosDBContainerResourceItem,
    document: unknown,
): Promise<{ document: unknown; error: string }> {
    try {
        if (node instanceof CosmosDBContainerResourceItem) {
            // await needs to catch the error here, otherwise it will be thrown to the caller
            return await insertDocumentIntoCosmosDB(node, document as ItemDefinition);
        }
    } catch (e) {
        return { document, error: parseError(e).message };
    }

    return { document, error: l10n.t('Unknown error') };
}

async function insertDocumentIntoCosmosDB(
    node: CosmosDBContainerResourceItem,
    document: ItemDefinition,
): Promise<{ document: ItemDefinition; error: string }> {
    const { endpoint, credentials, isEmulator } = node.model.accountInfo;
    const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
    const response = await cosmosClient
        .database(node.model.database.id)
        .container(node.model.container.id)
        .items.create<ItemDefinition>(document);

    if (response.resource) {
        return { document, error: '' };
    } else {
        return { document, error: l10n.t('The insertion failed with status code {0}', response.statusCode) };
    }
}

async function insertDocumentWithBuffer(
    document: Document,
    buffer: DocumentBufferforMongo,
): Promise<{ count: number; error: Array<{ index: number; errmsg: string }> | string | undefined } | undefined> {
    return await buffer.addDocument(document);
}

function handleInsertionResultForMongo(
    result: { count: number; error: Array<{ index: number; errmsg: string }> | string | undefined } | undefined,
    i: number,
    hasErrorsRef: boolean,
): { insertedCount: number; hasError: boolean } {
    let insertedCount = 0;
    let hasError = false || hasErrorsRef;

    if (!result?.error) {
        // all documents inserted or just pushed to buffer
        insertedCount += result?.count ?? 0;
    } else if (typeof result.error === 'string') {
        // error from single document insertion
        ext.outputChannel.appendLog(
            l10n.t('The insertion of document {number} failed with error: {error}', {
                number: i + 1,
                error: result.error,
            }),
        );
        ext.outputChannel.show();
        hasError = true;
    } else if (result.error[0].index >= 0) {
        // error from batch insertion
        hasError = true;
        insertedCount += result.count;
        const startIndex = i - result.error.length - result.count;
        for (const errorEle of result.error) {
            ext.outputChannel.appendLog(
                l10n.t('The insertion of document {number} failed with error: {error}', {
                    number: startIndex + errorEle.index + 1,
                    error: errorEle.errmsg,
                }),
            );
            ext.outputChannel.show();
        }
    } else {
        // all batch inserted documents failed
        ext.outputChannel.appendLog(
            l10n.t('The insertion of document {startNumber}-{endNumber} failed with error: {error}', {
                startNumber: i + result.error[0].index + 1,
                endNumber: i + 1,
                error: result.error[0].errmsg,
            }),
        );
        ext.outputChannel.show();
        hasError = true;
    }

    return { insertedCount, hasError };
}
