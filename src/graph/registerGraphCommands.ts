/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerCommand } from "vscode-azureextensionui";
import { ext } from '../extensionVariables';
import { GraphViewsManager } from "./GraphViewsManager";
import { GraphAccountTreeItem } from "./tree/GraphAccountTreeItem";
import { GraphCollectionTreeItem } from "./tree/GraphCollectionTreeItem";
import { GraphDatabaseTreeItem } from "./tree/GraphDatabaseTreeItem";
import { GraphTreeItem } from "./tree/GraphTreeItem";

export function registerGraphCommands(context: vscode.ExtensionContext): void {
    let graphViewsManager = new GraphViewsManager(context);

    registerCommand('cosmosDB.createGraphDatabase', async (node?: GraphAccountTreeItem) => {
        if (!node) {
            node = <GraphAccountTreeItem>await ext.tree.showTreeItemPicker(GraphAccountTreeItem.contextValue);
        }
        await node.createChild();
    });
    registerCommand('cosmosDB.createGraph', async (node?: GraphDatabaseTreeItem) => {
        if (!node) {
            node = <GraphDatabaseTreeItem>await ext.tree.showTreeItemPicker(GraphDatabaseTreeItem.contextValue);
        }
        await node.createChild();
    });
    registerCommand('cosmosDB.deleteGraphDatabase', async (node?: GraphDatabaseTreeItem) => {
        if (!node) {
            node = <GraphDatabaseTreeItem>await ext.tree.showTreeItemPicker(GraphDatabaseTreeItem.contextValue);
        }
        await node.deleteTreeItem();
    });
    registerCommand('cosmosDB.deleteGraph', async (node?: GraphCollectionTreeItem) => {
        if (!node) {
            node = <GraphCollectionTreeItem>await ext.tree.showTreeItemPicker(GraphCollectionTreeItem.contextValue);
        }
        await node.deleteTreeItem();
    });
    registerCommand('cosmosDB.openGraphExplorer', async (node: GraphTreeItem) => {
        if (!node) {
            node = <GraphTreeItem>await ext.tree.showTreeItemPicker(GraphTreeItem.contextValue);
        }
        await node.showExplorer(graphViewsManager);
    });
}
