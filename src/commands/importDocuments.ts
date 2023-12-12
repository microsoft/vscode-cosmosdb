/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemDefinition } from '@azure/cosmos';
import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import * as fse from 'fs-extra';
import * as vscode from 'vscode';
import { cosmosMongoFilter, sqlFilter } from '../constants';
import { DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { ext } from '../extensionVariables';
import { MongoCollectionTreeItem } from '../mongo/tree/MongoCollectionTreeItem';
import { nonNullProp, nonNullValue } from '../utils/nonNull';
import { getRootPath } from '../utils/workspacUtils';

export async function importDocuments(context: IActionContext, uris: vscode.Uri[] | undefined, collectionNode: MongoCollectionTreeItem | DocDBCollectionTreeItem | undefined): Promise<void> {
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
        ext.outputChannel.appendLog(`Ignoring the following files which are not json:`);
        ignoredUris.forEach(uri => ext.outputChannel.appendLine(`${uri.fsPath}`));
        ext.outputChannel.show();
    }
    if (!collectionNode) {
        collectionNode = await ext.rgApi.pickAppResource<MongoCollectionTreeItem | DocDBCollectionTreeItem>(context, {
            filter: [
                cosmosMongoFilter,
                sqlFilter
            ],
            expectedChildContextValue: [MongoCollectionTreeItem.contextValue, DocDBCollectionTreeItem.contextValue]
        });
    }
    let result: string;
    result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Importing documents..."
        },
        async (progress) => {
            uris = nonNullValue(uris, 'uris');
            collectionNode = nonNullValue(collectionNode, 'collectionNode');

            progress.report({ increment: 20, message: "Parsing documents for errors" });
            const documents = await parseDocuments(uris);
            progress.report({ increment: 30, message: "Parsed documents. Importing" });
            if (collectionNode instanceof MongoCollectionTreeItem) {
                result = await insertDocumentsIntoMongo(collectionNode, documents);
            } else {
                result = await insertDocumentsIntoDocdb(collectionNode, documents, uris);
            }
            progress.report({ increment: 50, message: "Finished importing" });
            return result;
        }
    );

    await collectionNode.refresh(context);
    await vscode.window.showInformationMessage(result);
}

async function askForDocuments(context: IActionContext): Promise<vscode.Uri[]> {
    const openDialogOptions: vscode.OpenDialogOptions = {
        canSelectMany: true,
        openLabel: "Import",
        filters: {
            JSON: ["json"]
        }
    };
    const rootPath: string | undefined = getRootPath();
    if (rootPath) {
        openDialogOptions.defaultUri = vscode.Uri.file(rootPath);
    }
    return await context.ui.showOpenDialog(openDialogOptions);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseDocuments(uris: vscode.Uri[]): Promise<any[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let documents: any[] = [];
    let errorFoundFlag: boolean = false;
    for (const uri of uris) {
        let parsed;
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            parsed = await fse.readJSON(uri.fsPath);
        } catch (e) {
            if (!errorFoundFlag) {
                errorFoundFlag = true;
                ext.outputChannel.appendLog("Errors found in documents listed below. Please fix these.");
                ext.outputChannel.show();
            }
            const err = parseError(e);
            ext.outputChannel.appendLine(`${uri.path}:\n${err.message}`);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertDocumentsIntoDocdb(collectionNode: DocDBCollectionTreeItem, documents: any[], uris: vscode.Uri[]): Promise<string> {
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
        erroneousFiles.forEach(file => ext.outputChannel.appendLine(file.path));
        ext.outputChannel.show();
        throw new Error(`See output for list of documents that do not contain the partition key '${nonNullProp(collectionNode, 'partitionKey').paths[0]}' required by collection '${collectionNode.label}'`);
    }
    for (const document of documents) {
        const retrieved: ItemDefinition = await collectionNode.documentsTreeItem.createDocument(document);
        if (retrieved.id) {
            ids.push(retrieved.id);
        }
    }
    const result: string = `Import into SQL successful. Inserted ${ids.length} document(s). See output for more details.`;
    for (const id of ids) {
        ext.outputChannel.appendLine(`Inserted document: ${id}`);
    }
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertDocumentsIntoMongo(node: MongoCollectionTreeItem, documents: any[]): Promise<string> {
    let output = "";
    const parsed = await node.collection.insertMany(documents);
    if (parsed.acknowledged) {
        output = `Import into mongo successful. Inserted ${parsed.insertedCount} document(s). See output for more details.`;
        for (const inserted of Object.values(parsed.insertedIds)) {
            ext.outputChannel.appendLine(`Inserted document: ${inserted}`);
        }
    }
    return output;
}
