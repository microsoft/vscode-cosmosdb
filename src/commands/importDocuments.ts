/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { EJSON } from 'bson';
import * as fse from 'fs-extra';
import { type InsertManyResult } from 'mongodb';
import * as vscode from 'vscode';
import { cosmosMongoFilter, sqlFilter } from '../constants';
import { DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { ext } from '../extensionVariables';
import { MongoCollectionTreeItem } from '../mongo/tree/MongoCollectionTreeItem';
import { type InsertDocumentsResult } from '../mongoClusters/MongoClustersClient';
import { CollectionItem } from '../mongoClusters/tree/CollectionItem';
import { nonNullProp, nonNullValue } from '../utils/nonNull';
import { getRootPath } from '../utils/workspacUtils';

export async function importDocuments(
    context: IActionContext,
    uris: vscode.Uri[] | undefined,
    collectionNode: MongoCollectionTreeItem | DocDBCollectionTreeItem | CollectionItem | undefined,
): Promise<void> {
    if (!uris) {
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
        ext.outputChannel.appendLog(`Ignoring the following files that do not match the "*.json" file name pattern:`);
        ignoredUris.forEach((uri) => ext.outputChannel.appendLog(`${uri.fsPath}`));
        ext.outputChannel.show();
    }
    if (!collectionNode) {
        collectionNode = await ext.rgApi.pickAppResource<MongoCollectionTreeItem | DocDBCollectionTreeItem>(context, {
            filter: [cosmosMongoFilter, sqlFilter],
            expectedChildContextValue: [MongoCollectionTreeItem.contextValue, DocDBCollectionTreeItem.contextValue],
        });
    }

    // adding a precaution for the mongoClusters path
    if (!collectionNode) {
        throw new Error('No collection selected.');
    }

    let result: string;
    result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Importing documents...',
        },
        async (progress) => {
            uris = nonNullValue(uris, 'uris');
            collectionNode = nonNullValue(collectionNode, 'collectionNode');

            progress.report({ increment: 20, message: 'Loading documents...' });

            const supportEJSON: boolean = collectionNode instanceof CollectionItem; // added this line for better readability
            const documents: unknown[] = await parseDocuments(uris, supportEJSON);

            progress.report({ increment: 30, message: `Loaded ${documents.length} document(s). Importing...` });
            if (collectionNode instanceof MongoCollectionTreeItem) {
                result = await insertDocumentsIntoMongo(collectionNode, documents);
            } else if (collectionNode instanceof CollectionItem) {
                result = await insertDocumentsIntoMongoCluster(context, collectionNode, documents);
            } else {
                result = await insertDocumentsIntoDocdb(collectionNode, documents, uris);
            }
            progress.report({ increment: 50, message: 'Finished importing' });
            return result;
        },
    );

    if (collectionNode instanceof CollectionItem === false) {
        await collectionNode.refresh(context);
    }

    await vscode.window.showInformationMessage(result);
}

async function askForDocuments(context: IActionContext): Promise<vscode.Uri[]> {
    const openDialogOptions: vscode.OpenDialogOptions = {
        canSelectMany: true,
        openLabel: 'Import',
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

/**
 * Parses an array of URIs to read JSON documents and returns them as an array of unknown objects.
 * If any errors are encountered while reading the documents, they are logged to the output channel.
 *
 * @param uris - An array of `vscode.Uri` objects representing the file paths to the JSON documents.
 * @param supportEJSON - An optional boolean parameter that indicates whether to support extended JSON (EJSON).
 *                       EJSON is used to read documents that are supposed to be converted into BSON.
 *                       EJSON supports more datatypes and is specific to MongoDB. This is currently used for MongoDB clusters/vcore.
 * @returns A promise that resolves to an array of parsed documents as unknown objects.
 * @throws An error if any documents contain errors, prompting the user to fix them and try again.
 */
async function parseDocuments(uris: vscode.Uri[], supportEJSON: boolean = false): Promise<unknown[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let documents: any[] = [];
    let errorFoundFlag: boolean = false;
    for (const uri of uris) {
        let parsed;
        try {
            if (supportEJSON) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                parsed = EJSON.parse(await fse.readFile(uri.fsPath, 'utf8'));
            } else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                parsed = await fse.readJSON(uri.fsPath);
            }
        } catch (e) {
            if (!errorFoundFlag) {
                errorFoundFlag = true;
                ext.outputChannel.appendLog('Errors found in documents listed below. Please fix these.');
                ext.outputChannel.show();
            }
            const err = parseError(e);
            ext.outputChannel.appendLog(`${uri.path}:\n${err.message}`);
        }
        if (parsed) {
            if (Array.isArray(parsed)) {
                documents = documents.concat(parsed);
            } else {
                documents.push(parsed);
            }
        }
    }
    if (errorFoundFlag) {
        throw new Error(`Errors found in some documents. Please see the output, fix these and try again.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return documents;
}

async function insertDocumentsIntoDocdb(
    collectionNode: DocDBCollectionTreeItem,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    documents: any[],
    uris: vscode.Uri[],
): Promise<string> {
    const ids: string[] = [];
    let i = 0;
    const erroneousFiles: vscode.Uri[] = [];
    for (i = 0; i < documents.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const document: ItemDefinition = documents[i];
        if (!collectionNode.documentsTreeItem.documentHasPartitionKey(document)) {
            erroneousFiles.push(uris[i]);
        }
    }
    if (erroneousFiles.length) {
        ext.outputChannel.appendLog(`The following documents do not contain the required partition key:`);
        erroneousFiles.forEach((file) => ext.outputChannel.appendLog(file.path));
        ext.outputChannel.show();
        throw new Error(
            `See output for list of documents that do not contain the partition key '${nonNullProp(collectionNode, 'partitionKey').paths[0]}' required by collection '${collectionNode.label}'`,
        );
    }
    for (const document of documents) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const retrieved: ItemDefinition = await collectionNode.documentsTreeItem.createDocument(document);
        if (retrieved.id) {
            ids.push(retrieved.id);
        }
    }
    const result: string = `Import into NoSQL successful. Inserted ${ids.length} document(s). See output for more details.`;
    for (const id of ids) {
        ext.outputChannel.appendLog(`Inserted document: ${id}`);
    }
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertDocumentsIntoMongo(node: MongoCollectionTreeItem, documents: any[]): Promise<string> {
    let output = '';

    let parsed: InsertManyResult<Document> | undefined;
    await callWithTelemetryAndErrorHandling('cosmosDB.mongo.importDocumets', async (actionContext) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        parsed = await node.collection.insertMany(documents);

        actionContext.telemetry.measurements.documentCount = parsed?.insertedCount;
    });

    if (parsed?.acknowledged) {
        output = `Import into mongo successful. Inserted ${parsed.insertedCount} document(s). See output for more details.`;
        for (const inserted of Object.values(parsed.insertedIds)) {
            ext.outputChannel.appendLog(`Inserted document: ${inserted}`);
        }
    }
    return output;
}

async function insertDocumentsIntoMongoCluster(
    context: IActionContext,
    node: CollectionItem,
    documents: unknown[],
): Promise<string> {
    let result: InsertDocumentsResult | undefined;
    await callWithTelemetryAndErrorHandling('cosmosDB.mongoClusters.importDocumets', async (actionContext) => {
        result = await node.insertDocuments(context, documents as Document[]);

        actionContext.telemetry.measurements.documentCount = result?.insertedCount;
    });

    let message: string;
    if (result?.acknowledged) {
        message = `Import successful. Inserted ${result.insertedCount} document(s).`;
    } else {
        message = `Import failed. The operation was not acknowledged by the database.`;
    }

    ext.outputChannel.appendLog('MongoDB Clusters ' + message);
    return message;
}
