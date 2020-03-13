/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, registerCommand } from "vscode-azureextensionui";
import { doubleClickDebounceDelay } from '../constants';
import { ext } from '../extensionVariables';
import { GraphAccountTreeItem } from "./tree/GraphAccountTreeItem";
import { GraphCollectionTreeItem } from "./tree/GraphCollectionTreeItem";
import { GraphDatabaseTreeItem } from "./tree/GraphDatabaseTreeItem";
import { GraphTreeItem } from "./tree/GraphTreeItem";

export function registerGraphCommands(): void {
    registerCommand('cosmosDB.createGraphDatabase', async (context: IActionContext, node?: GraphAccountTreeItem) => {
        if (!node) {
            node = <GraphAccountTreeItem>await ext.tree.showTreeItemPicker(GraphAccountTreeItem.contextValue, context);
        }
        await node.createChild(context);
    });
    registerCommand('cosmosDB.createGraph', async (context: IActionContext, node?: GraphDatabaseTreeItem) => {
        if (!node) {
            node = <GraphDatabaseTreeItem>await ext.tree.showTreeItemPicker(GraphDatabaseTreeItem.contextValue, context);
        }
        await node.createChild(context);
    });
    registerCommand('cosmosDB.deleteGraphDatabase', async (context: IActionContext, node?: GraphDatabaseTreeItem) => {
        if (!node) {
            node = <GraphDatabaseTreeItem>await ext.tree.showTreeItemPicker(GraphDatabaseTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.deleteGraph', async (context: IActionContext, node?: GraphCollectionTreeItem) => {
        if (!node) {
            node = <GraphCollectionTreeItem>await ext.tree.showTreeItemPicker(GraphCollectionTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.openGraphExplorer', async (context: IActionContext, node: GraphTreeItem) => {
        if (!node) {
            node = <GraphTreeItem>await ext.tree.showTreeItemPicker(GraphTreeItem.contextValue, context);
        }
        await node.showExplorer(context);
        // tslint:disable-next-line:align
    }, doubleClickDebounceDelay);
}
