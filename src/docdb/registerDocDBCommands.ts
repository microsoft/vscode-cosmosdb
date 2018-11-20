/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { doubleClickDebounceDelay } from "src/constants";
import { commands } from "vscode";
import { registerCommand } from "vscode-azureextensionui";
import { CosmosEditorManager } from "../CosmosEditorManager";
import { ext } from "../extensionVariables";
import { DocDBStoredProcedureNodeEditor } from "./editors/DocDBStoredProcedureNodeEditor";
import { DocDBAccountTreeItem } from "./tree/DocDBAccountTreeItem";
import { DocDBCollectionTreeItem } from "./tree/DocDBCollectionTreeItem";
import { DocDBDatabaseTreeItem } from "./tree/DocDBDatabaseTreeItem";
import { DocDBDocumentsTreeItem } from "./tree/DocDBDocumentsTreeItem";
import { DocDBDocumentTreeItem } from "./tree/DocDBDocumentTreeItem";
import { DocDBStoredProceduresTreeItem } from "./tree/DocDBStoredProceduresTreeItem";
import { DocDBStoredProcedureTreeItem } from "./tree/DocDBStoredProcedureTreeItem";

export function registerDocDBCommands(editorManager: CosmosEditorManager): void {
    registerCommand('cosmosDB.createDocDBDatabase', async (node?: DocDBAccountTreeItem) => {
        if (!node) {
            node = <DocDBAccountTreeItem>await ext.tree.showTreeItemPicker(DocDBAccountTreeItem.contextValue);
        }
        const databaseNode: DocDBDatabaseTreeItem = <DocDBDatabaseTreeItem>await node.createChild();
        await ext.treeView.reveal(databaseNode, { focus: false });
        const collectionNode: DocDBCollectionTreeItem = <DocDBCollectionTreeItem>await databaseNode.createChild();
        await ext.treeView.reveal(collectionNode);
    });
    registerCommand('cosmosDB.createDocDBCollection', async (node?: DocDBDatabaseTreeItem) => {
        if (!node) {
            node = <DocDBDatabaseTreeItem>await ext.tree.showTreeItemPicker(DocDBDatabaseTreeItem.contextValue);
        }
        const collectionNode: DocDBCollectionTreeItem = <DocDBCollectionTreeItem>await node.createChild();
        await ext.treeView.reveal(collectionNode);
    });
    registerCommand('cosmosDB.createDocDBDocument', async (node?: DocDBDocumentsTreeItem) => {
        if (!node) {
            node = <DocDBDocumentsTreeItem>await ext.tree.showTreeItemPicker(DocDBDocumentsTreeItem.contextValue);
        }
        let documentNode = <DocDBDocumentTreeItem>await node.createChild();
        await ext.treeView.reveal(documentNode);
        await commands.executeCommand("cosmosDB.openDocument", documentNode);

    });
    registerCommand('cosmosDB.createDocDBStoredProcedure', async (node?: DocDBStoredProceduresTreeItem) => {
        if (!node) {
            node = <DocDBStoredProceduresTreeItem>await ext.tree.showTreeItemPicker(DocDBStoredProceduresTreeItem.contextValue);
        }
        let childNode = await node.createChild();
        await commands.executeCommand("cosmosDB.openStoredProcedure", childNode);

    });
    registerCommand('cosmosDB.deleteDocDBDatabase', async (node?: DocDBDatabaseTreeItem) => {
        if (!node) {
            node = <DocDBDatabaseTreeItem>await ext.tree.showTreeItemPicker(DocDBDatabaseTreeItem.contextValue);
        }
        await node.deleteTreeItem();
    });
    registerCommand('cosmosDB.deleteDocDBCollection', async (node?: DocDBCollectionTreeItem) => {
        if (!node) {
            node = <DocDBCollectionTreeItem>await ext.tree.showTreeItemPicker(DocDBCollectionTreeItem.contextValue);
        }
        await node.deleteTreeItem();
    });
    registerCommand('cosmosDB.openStoredProcedure', async (node?: DocDBStoredProcedureTreeItem) => {
        if (!node) {
            node = <DocDBStoredProcedureTreeItem>await ext.tree.showTreeItemPicker([DocDBStoredProcedureTreeItem.contextValue]);
        }
        await editorManager.showDocument(new DocDBStoredProcedureNodeEditor(node), node.label + '-cosmos-stored-procedure.js');
        // tslint:disable-next-line:align
    }, doubleClickDebounceDelay);
    registerCommand('cosmosDB.deleteDocDBDocument', async (node?: DocDBDocumentTreeItem) => {
        if (!node) {
            node = <DocDBDocumentTreeItem>await ext.tree.showTreeItemPicker(DocDBDocumentTreeItem.contextValue);
        }
        await node.deleteTreeItem();
    });
    registerCommand('cosmosDB.deleteDocDBStoredProcedure', async (node?: DocDBStoredProcedureTreeItem) => {
        if (!node) {
            node = <DocDBStoredProcedureTreeItem>await ext.tree.showTreeItemPicker(DocDBStoredProcedureTreeItem.contextValue);
        }
        await node.deleteTreeItem();
    });
}
