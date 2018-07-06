/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands } from "vscode";
import { AzureTreeDataProvider, IAzureNode, IAzureParentNode, registerCommand } from "vscode-azureextensionui";
import { CosmosEditorManager } from "../CosmosEditorManager";
import { DocDBStoredProcedureNodeEditor } from "./editors/DocDBStoredProcedureNodeEditor";
import { DocDBAccountTreeItem } from "./tree/DocDBAccountTreeItem";
import { DocDBCollectionTreeItem } from "./tree/DocDBCollectionTreeItem";
import { DocDBDatabaseTreeItem } from "./tree/DocDBDatabaseTreeItem";
import { DocDBDocumentsTreeItem } from "./tree/DocDBDocumentsTreeItem";
import { DocDBDocumentTreeItem } from "./tree/DocDBDocumentTreeItem";
import { DocDBStoredProcedureTreeItem } from "./tree/DocDBStoredProcedureTreeItem";

export function registerDocDBCommands(tree: AzureTreeDataProvider, editorManager: CosmosEditorManager): void {
    registerCommand('cosmosDB.createDocDBDatabase', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(DocDBAccountTreeItem.contextValue);
        }
        const databaseNode: IAzureParentNode = <IAzureParentNode>await node.createChild();
        await databaseNode.createChild();
    });
    registerCommand('cosmosDB.createDocDBCollection', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(DocDBDatabaseTreeItem.contextValue);
        }
        await node.createChild();
    });
    registerCommand('cosmosDB.createDocDBDocument', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(DocDBDocumentsTreeItem.contextValue);
        }
        let childNode = await node.createChild();
        await commands.executeCommand("cosmosDB.openDocument", childNode);

    });
    registerCommand('cosmosDB.createDocDBStoredProcedure', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(DocDBDocumentsTreeItem.contextValue);
        }
        let childNode = await node.createChild();
        await commands.executeCommand("cosmosDB.openStoredProcedure", childNode);

    });
    registerCommand('cosmosDB.deleteDocDBDatabase', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(DocDBDatabaseTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    registerCommand('cosmosDB.deleteDocDBCollection', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(DocDBCollectionTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    registerCommand('cosmosDB.openStoredProcedure', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker([DocDBStoredProcedureTreeItem.contextValue]);
        }
        await editorManager.showDocument(new DocDBStoredProcedureNodeEditor(<IAzureNode<DocDBStoredProcedureTreeItem>>node), 'cosmos-stored-procedure.js');
    });
    registerCommand('cosmosDB.deleteDocDBDocument', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(DocDBDocumentTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    registerCommand('cosmosDB.deleteDocDBStoredProcedure', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(DocDBStoredProcedureTreeItem.contextValue);
        }
        await node.deleteNode();
    });
}
