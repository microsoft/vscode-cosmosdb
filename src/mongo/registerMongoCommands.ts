/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureActionHandler, IAzureParentNode, AzureTreeDataProvider, IAzureNode, IActionContext } from "vscode-azureextensionui";
import * as vscode from 'vscode';
import { MongoCollectionTreeItem } from "./tree/MongoCollectionTreeItem";
import { MongoDatabaseTreeItem } from "./tree/MongoDatabaseTreeItem";
import { MongoAccountTreeItem } from "./tree/MongoAccountTreeItem";
import MongoDBLanguageClient from "./languageClient";
import * as vscodeUtil from '../utils/vscodeUtils';
import { MongoCommands } from "./commands";
import { MongoDocumentTreeItem } from "./tree/MongoDocumentTreeItem";
import { MongoCollectionNodeEditor } from "./editors/MongoCollectionNodeEditor";
import { CosmosEditorManager } from "../CosmosEditorManager";
import { ext } from "../extensionVariables";

const connectedDBKey: string = 'ms-azuretools.vscode-cosmosdb.connectedDB';

export function registerMongoCommands(context: vscode.ExtensionContext, actionHandler: AzureActionHandler, tree: AzureTreeDataProvider, editorManager: CosmosEditorManager): void {
    let languageClient: MongoDBLanguageClient = new MongoDBLanguageClient(context);

    const loadPersistedMongoDBTask: Promise<void> = loadPersistedMongoDB(context, tree);

    actionHandler.registerCommand('cosmosDB.createMongoDatabase', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoAccountTreeItem.contextValue);
        }
        const childNode = await node.createChild();
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode);
    });
    actionHandler.registerCommand('cosmosDB.createMongoCollection', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }
        const childNode = await node.createChild();
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode.parent);
    });
    actionHandler.registerCommand('cosmosDB.createMongoDocument', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        await node.createChild();
    });
    actionHandler.registerCommand('cosmosDB.connectMongoDB', async (node?: IAzureParentNode<MongoDatabaseTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<MongoDatabaseTreeItem>>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }

        const oldNode: IAzureNode | undefined = ext.connectedMongoDB;
        await languageClient.connect(node.treeItem.connectionString, node.treeItem.databaseName);
        context.globalState.update(connectedDBKey, node.id);
        ext.connectedMongoDB = node;
        await tree.refresh(node.parent);

        if (oldNode) {
            await tree.refresh(oldNode.parent);
        }
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoDB', async (node?: IAzureNode<MongoDatabaseTreeItem>) => {
        if (!node) {
            node = <IAzureNode<MongoDatabaseTreeItem>>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }
        await node.deleteNode();
        if (ext.connectedMongoDB && ext.connectedMongoDB.id === node.id) {
            ext.connectedMongoDB = undefined;
            context.globalState.update(connectedDBKey, undefined);
            languageClient.disconnect();
        }
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoCollection', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoDocument', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(MongoDocumentTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.openCollection', async (node?: IAzureParentNode<MongoCollectionTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<MongoCollectionTreeItem>>await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        await editorManager.showDocument(new MongoCollectionNodeEditor(node), 'cosmos-collection.json');
    });
    actionHandler.registerCommand('cosmosDB.launchMongoShell', launchMongoShell);
    actionHandler.registerCommand('cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', context.extensionPath, 'Scrapbook', '.mongo'));
    actionHandler.registerCommand('cosmosDB.executeMongoCommand', async function (this: IActionContext) {
        await loadPersistedMongoDBTask;
        await MongoCommands.executeCommandFromActiveEditor(<IAzureParentNode<MongoDatabaseTreeItem>>ext.connectedMongoDB, context.extensionPath, editorManager, tree, this);
    });
}

async function loadPersistedMongoDB(context: vscode.ExtensionContext, tree: AzureTreeDataProvider): Promise<void> {
    const persistedNodeId: string | undefined = context.globalState.get(connectedDBKey);
    if (persistedNodeId) {
        const persistedNode: IAzureNode | undefined = await tree.findNode(persistedNodeId);
        if (persistedNode) {
            await vscode.commands.executeCommand('cosmosDB.connectMongoDB', persistedNode);
        }
    }
}

function launchMongoShell() {
    const terminal: vscode.Terminal = vscode.window.createTerminal('Mongo Shell');
    terminal.sendText(`mongo`);
    terminal.show();
}
