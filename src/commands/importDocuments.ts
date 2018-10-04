/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NewDocument } from 'documentdb';
import * as fse from 'fs-extra';
import * as vscode from 'vscode';
import { AzureTreeDataProvider, IAzureParentNode, parseError } from 'vscode-azureextensionui';
import { DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { DocDBDocumentsTreeItem } from '../docdb/tree/DocDBDocumentsTreeItem';
import { ext } from '../extensionVariables';
import { MongoCollectionTreeItem } from '../mongo/tree/MongoCollectionTreeItem';

export async function importDocuments(tree: AzureTreeDataProvider, uris: vscode.Uri[] | undefined, collectionNode: IAzureParentNode<MongoCollectionTreeItem | DocDBCollectionTreeItem> | undefined): Promise<void> {
    if (!uris) {
        uris = await askForDocuments();
    }
    let ignoredUris: vscode.Uri[] = []; //account for https://github.com/Microsoft/vscode/issues/59782
    uris = uris.filter((uri) => {
        if (uri.fsPath.endsWith('.json')) {
            return true;
        } else {
            ignoredUris.push(uri);
            return false;
        }
    });
    if (ignoredUris.length) {
        ext.outputChannel.appendLine(`The following selected files are not json: ${ignoredUris.map(uri => uri.fsPath).join(',')}. \nIgnoring these.`);
        ext.outputChannel.show();
    }
    if (!collectionNode) {
        collectionNode = <IAzureParentNode<MongoCollectionTreeItem | DocDBCollectionTreeItem>>await tree.showNodePicker([MongoCollectionTreeItem.contextValue, DocDBCollectionTreeItem.contextValue]);
    }

    const documents = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Import documents..."
        },
        (_progress) => parseDocumentsForErrors(uris)
    );

    let result: string;
    if (collectionNode.treeItem instanceof MongoCollectionTreeItem) {
        const collectionTreeItem = <MongoCollectionTreeItem>collectionNode.treeItem;
        result = await collectionTreeItem.executeCommand('insertMany', [JSON.stringify(documents)]);
    } else {
        result = await insertDocumentsIntoDocdb(<IAzureParentNode<DocDBCollectionTreeItem>>collectionNode, documents, uris);
    }
    await collectionNode.refresh();
    await vscode.window.showInformationMessage(result);
}

async function askForDocuments(): Promise<vscode.Uri[]> {
    return await ext.ui.showOpenDialog({
        canSelectMany: true,
        openLabel: "Import",
        filters: {
            "JSON": ["json"]
        },
        defaultUri: vscode.Uri.file(vscode.workspace.rootPath)
    });
}

// tslint:disable-next-line:no-any
async function parseDocumentsForErrors(nodes: vscode.Uri[]): Promise<any[]> {
    const parseResult = await parseDocuments(nodes);
    const documents = parseResult[0];
    const hasErrors: boolean = parseResult[1];
    if (hasErrors) {
        throw new Error(`Errors found in some documents.\nPlease see the output, fix these and try again.`);
    }
    return documents;
}

// tslint:disable-next-line:no-any
async function parseDocuments(uris: vscode.Uri[]): Promise<[any[], boolean]> {
    let documents = [];
    let errors = {};
    let errorFoundFlag: boolean = false;
    for (let uri of uris) {
        const text: string = await fse.readFile(uri.fsPath, 'utf-8');
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            if (!errorFoundFlag) {
                ext.outputChannel.appendLine("Errors found in documents listed below. Please fix these.");
                ext.outputChannel.show();
            }
            const err = parseError(e);
            errors[uri.path] = err;
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
    return [documents, !!Object.keys(errors).length];
}

// tslint:disable-next-line:no-any
async function insertDocumentsIntoDocdb(collectionNode: IAzureParentNode<DocDBCollectionTreeItem>, documents: any[], uris: vscode.Uri[]): Promise<string> {
    let result;
    let ids = [];
    let children = (await collectionNode.getCachedChildren());
    const documentsTreeItem: DocDBDocumentsTreeItem = <DocDBDocumentsTreeItem>(children.find(node => node.treeItem instanceof DocDBDocumentsTreeItem).treeItem);
    let i = 0;
    let erroneousFiles: vscode.Uri[] = [];
    for (i = 0; i < documents.length; i++) {
        let document: NewDocument = documents[i];
        if (!documentsTreeItem.documentHasPartitionKey(document)) {
            erroneousFiles.push(uris[i]);
        }
    }
    if (erroneousFiles.length) {
        ext.outputChannel.appendLine(`The following documents do not contain the required partition key:`);
        erroneousFiles.forEach(file => ext.outputChannel.appendLine(file.path));
        ext.outputChannel.show();
        throw new Error(`Some documents do not contain the Partition Key field required by the collection ${collectionNode.treeItem.label}. Please ensure every document contains this field. See output for list of documents.`);
    }
    for (i = 0; i < documents.length; i++) {
        let document: NewDocument = documents[i];
        const retrieved = await documentsTreeItem.createDocument(document);
        ids.push(retrieved.id);
    }
    result = `Imported ${ids.length} documents`;
    return result;
}
