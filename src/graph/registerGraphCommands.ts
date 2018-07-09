/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureTreeDataProvider, IAzureNode, IAzureParentNode, registerCommand } from "vscode-azureextensionui";
import { GraphViewsManager } from "./GraphViewsManager";
import { GraphAccountTreeItem } from "./tree/GraphAccountTreeItem";
import { GraphCollectionTreeItem } from "./tree/GraphCollectionTreeItem";
import { GraphDatabaseTreeItem } from "./tree/GraphDatabaseTreeItem";
import { GraphTreeItem } from "./tree/GraphTreeItem";

export function registerGraphCommands(context: vscode.ExtensionContext, tree: AzureTreeDataProvider): void {
    let graphViewsManager = new GraphViewsManager(context);

    registerCommand('cosmosDB.createGraphDatabase', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(GraphAccountTreeItem.contextValue);
        }
        await node.createChild();
    });
    registerCommand('cosmosDB.createGraph', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(GraphDatabaseTreeItem.contextValue);
        }
        await node.createChild();
    });
    registerCommand('cosmosDB.deleteGraphDatabase', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(GraphDatabaseTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    registerCommand('cosmosDB.deleteGraph', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(GraphCollectionTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    registerCommand('cosmosDB.openGraphExplorer', async (node: IAzureNode<GraphTreeItem>) => {
        if (!node) {
            node = <IAzureNode<GraphTreeItem>>await tree.showNodePicker(GraphCollectionTreeItem.contextValue);
        }
        await node.treeItem.showExplorer(graphViewsManager);
    });
}
