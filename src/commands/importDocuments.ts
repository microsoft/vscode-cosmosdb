/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NewDocument } from 'documentdb';
import * as fse from 'fs-extra';
import { DocDBDocumentsTreeItem } from 'src/docdb/tree/DocDBDocumentsTreeItem';
import * as vscode from 'vscode';
import { AzureTreeDataProvider, IAzureParentNode, parseError, UserCancelledError } from 'vscode-azureextensionui';
import { DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { ext } from '../extensionVariables';
import { MongoCollectionTreeItem } from '../mongo/tree/MongoCollectionTreeItem';
import { withProgress } from '../mongo/tree/MongoDatabaseTreeItem';

export async function importDocuments(tree: AzureTreeDataProvider, uris: vscode.Uri[] | undefined, collectionNode: IAzureParentNode<MongoCollectionTreeItem | DocDBCollectionTreeItem> | undefined): Promise<void> {
    if (!uris) {
        uris = await askForDocuments();
    }
    uris = uris.filter((uri) => uri.fsPath.endsWith('.json'));
    const documents = await withProgress(parseDocumentsForErrors(uris), "Parsing documents...", vscode.ProgressLocation.Notification);

    if (!collectionNode) {
        collectionNode = <IAzureParentNode<MongoCollectionTreeItem | DocDBCollectionTreeItem>>await tree.showNodePicker([MongoCollectionTreeItem.contextValue, DocDBCollectionTreeItem.contextValue]);
    }
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
    let files: vscode.Uri[] = await vscode.workspace.findFiles("*.json");
    let jsonDocuments: (vscode.QuickPickItem & { uri: vscode.Uri })[] = [];
    let items: (vscode.QuickPickItem & { uri: vscode.Uri })[] = files.map(file => {
        return { uri: file, label: vscode.workspace.asRelativePath(file) };
    });
    let pickAgain: string = "Pick again";
    let discontinue = "Discontiue import";
    while (!jsonDocuments.length) {
        jsonDocuments = await ext.ui.showQuickPick(items, { canPickMany: true, placeHolder: "Choose a document to upload. Hit Escape to Cancel" });
        if (!jsonDocuments.length) {
            let action: string = await vscode.window.showWarningMessage("No document picked. Want to pick again?", pickAgain, discontinue);
            if (action === discontinue) {
                throw new UserCancelledError();
            }
        }
    }
    return jsonDocuments.map(choice => choice.uri);
}

// tslint:disable-next-line:no-any
async function parseDocumentsForErrors(nodes: vscode.Uri[]): Promise<any[]> {
    const parseResult = await parseDocuments(nodes);
    const documents = parseResult[0];
    const errors: string[] = parseResult[1];
    if (errors.length > 0) {
        throw new Error(`Errors found in the following documents: ${errors.join(',')}.\nPlease fix these and try again.`);
    }
    return documents;
}

// tslint:disable-next-line:no-any
async function parseDocuments(uris: vscode.Uri[]): Promise<[any[], string[]]> {
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
            }
            const err = parseError(e);
            const fileName = uri.path.split('/').pop();
            errors[fileName] = err;
            ext.outputChannel.appendLine(`${fileName}:\n${err.message}`);
            ext.outputChannel.show();
        }
        if (parsed) {
            if (Array.isArray(parsed)) {
                documents = documents.concat(parsed);
            } else {
                documents.push(parsed);
            }
        }
    }
    return [documents, Object.keys(errors)];
}

// tslint:disable-next-line:no-any
async function insertDocumentsIntoDocdb(collectionNode: IAzureParentNode<DocDBCollectionTreeItem>, documents: any[], nodes: vscode.Uri[]): Promise<string> {
    let result;
    let ids = [];
    const documentsTreeItem: DocDBDocumentsTreeItem = <DocDBDocumentsTreeItem>(await collectionNode.getCachedChildren()[0].treeItem);
    let i = 0;
    for (i = 0; i < documents.length; i++) {
        let document: NewDocument = documents[i];
        if (!documentsTreeItem.documentHasPartitionKey(document)) {
            throw new Error(`Error in file ${vscode.workspace.asRelativePath(nodes[i])}. Please ensure every document has a partition key path for the collection you choose to import into.`);
        }
        const retrieved = await documentsTreeItem.createDocument(document);
        ids.push(retrieved.id);
    }
    result = `Imported ${ids.length} documents`;
    return result;
}
