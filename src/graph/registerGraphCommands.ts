/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeDataProvider, AzureActionHandler, IAzureParentNode, IAzureNode } from "vscode-azureextensionui";
import * as vscode from 'vscode';
import { GraphAccountTreeItem } from "./tree/GraphAccountTreeItem";
import { GraphDatabaseTreeItem } from "./tree/GraphDatabaseTreeItem";
import { GraphCollectionTreeItem } from "./tree/GraphCollectionTreeItem";
import { GraphViewsManager } from "./GraphViewsManager";

export function registerGraphCommands(context: vscode.ExtensionContext, actionHandler: AzureActionHandler, tree: AzureTreeDataProvider): void {
    let graphViewsManager = new GraphViewsManager(context, actionHandler);
    context.subscriptions.push(this.graphView);

    actionHandler.registerCommand('cosmosDB.createGraphDatabase', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(GraphAccountTreeItem.contextValue);
        }
        await node.createChild();
    });
    actionHandler.registerCommand('cosmosDB.createGraph', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(GraphDatabaseTreeItem.contextValue);
        }
        await node.createChild();
    });
    actionHandler.registerCommand('cosmosDB.deleteGraphDatabase', (node?: IAzureNode) => async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(GraphDatabaseTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.deleteGraph', (node?: IAzureNode) => async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(GraphCollectionTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.openGraphExplorer', async (node: IAzureNode<GraphCollectionTreeItem>) => {
        if (!node) {
            node = <IAzureNode<GraphCollectionTreeItem>>await tree.showNodePicker(GraphCollectionTreeItem.contextValue);
        }
        await node.treeItem.showExplorer(graphViewsManager);
    });
}
