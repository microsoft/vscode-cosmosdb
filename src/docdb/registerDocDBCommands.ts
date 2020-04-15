/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands } from "vscode";
import { IActionContext, registerCommand } from "vscode-azureextensionui";
import { doubleClickDebounceDelay } from "../constants";
import { ext } from "../extensionVariables";
import { DocDBStoredProcedureNodeEditor } from "./editors/DocDBStoredProcedureNodeEditor";
import { DocDBAccountTreeItem } from "./tree/DocDBAccountTreeItem";
import { DocDBCollectionTreeItem } from "./tree/DocDBCollectionTreeItem";
import { DocDBDatabaseTreeItem } from "./tree/DocDBDatabaseTreeItem";
import { DocDBDocumentsTreeItem } from "./tree/DocDBDocumentsTreeItem";
import { DocDBDocumentTreeItem } from "./tree/DocDBDocumentTreeItem";
import { DocDBStoredProceduresTreeItem } from "./tree/DocDBStoredProceduresTreeItem";
import { DocDBStoredProcedureTreeItem } from "./tree/DocDBStoredProcedureTreeItem";

export function registerDocDBCommands(): void {
    registerCommand('cosmosDB.createDocDBDatabase', async (context: IActionContext, node?: DocDBAccountTreeItem) => {
        if (!node) {
            node = <DocDBAccountTreeItem>await ext.tree.showTreeItemPicker(DocDBAccountTreeItem.contextValue, context);
        }
        const databaseNode: DocDBDatabaseTreeItem = <DocDBDatabaseTreeItem>await node.createChild(context);
        await ext.treeView.reveal(databaseNode, { focus: false });
        const collectionNode: DocDBCollectionTreeItem = <DocDBCollectionTreeItem>await databaseNode.createChild(context);
        await ext.treeView.reveal(collectionNode);
    });
    registerCommand('cosmosDB.createDocDBCollection', async (context: IActionContext, node?: DocDBDatabaseTreeItem) => {
        if (!node) {
            node = <DocDBDatabaseTreeItem>await ext.tree.showTreeItemPicker(DocDBDatabaseTreeItem.contextValue, context);
        }
        const collectionNode: DocDBCollectionTreeItem = <DocDBCollectionTreeItem>await node.createChild(context);
        await ext.treeView.reveal(collectionNode);
    });
    registerCommand('cosmosDB.createDocDBDocument', async (context: IActionContext, node?: DocDBDocumentsTreeItem) => {
        if (!node) {
            node = <DocDBDocumentsTreeItem>await ext.tree.showTreeItemPicker(DocDBDocumentsTreeItem.contextValue, context);
        }
        const documentNode = <DocDBDocumentTreeItem>await node.createChild(context);
        await ext.treeView.reveal(documentNode);
        await commands.executeCommand("cosmosDB.openDocument", documentNode);

    });
    registerCommand('cosmosDB.createDocDBStoredProcedure', async (context: IActionContext, node?: DocDBStoredProceduresTreeItem) => {
        if (!node) {
            node = <DocDBStoredProceduresTreeItem>await ext.tree.showTreeItemPicker(DocDBStoredProceduresTreeItem.contextValue, context);
        }
        const childNode = await node.createChild(context);
        await commands.executeCommand("cosmosDB.openStoredProcedure", childNode);

    });
    registerCommand('cosmosDB.deleteDocDBDatabase', async (context: IActionContext, node?: DocDBDatabaseTreeItem) => {
        if (!node) {
            node = <DocDBDatabaseTreeItem>await ext.tree.showTreeItemPicker(DocDBDatabaseTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.deleteDocDBCollection', async (context: IActionContext, node?: DocDBCollectionTreeItem) => {
        if (!node) {
            node = <DocDBCollectionTreeItem>await ext.tree.showTreeItemPicker(DocDBCollectionTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.openStoredProcedure', async (context: IActionContext, node?: DocDBStoredProcedureTreeItem) => {
        if (!node) {
            node = <DocDBStoredProcedureTreeItem>await ext.tree.showTreeItemPicker([DocDBStoredProcedureTreeItem.contextValue], context);
        }
        await ext.editorManager.showDocument(context, new DocDBStoredProcedureNodeEditor(node), node.label + '-cosmos-stored-procedure.js');
        // tslint:disable-next-line:align
    }, doubleClickDebounceDelay);
    registerCommand('cosmosDB.deleteDocDBDocument', async (context: IActionContext, node?: DocDBDocumentTreeItem) => {
        if (!node) {
            node = <DocDBDocumentTreeItem>await ext.tree.showTreeItemPicker(DocDBDocumentTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.deleteDocDBStoredProcedure', async (context: IActionContext, node?: DocDBStoredProcedureTreeItem) => {
        if (!node) {
            node = <DocDBStoredProcedureTreeItem>await ext.tree.showTreeItemPicker(DocDBStoredProcedureTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
}
