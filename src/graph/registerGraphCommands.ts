/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ITreeItemPickerContext, registerCommand } from "@microsoft/vscode-azext-utils";
import { doubleClickDebounceDelay } from '../constants';
import { ext } from '../extensionVariables';
import { GraphAccountTreeItem } from "./tree/GraphAccountTreeItem";
import { GraphCollectionTreeItem } from "./tree/GraphCollectionTreeItem";
import { GraphDatabaseTreeItem } from "./tree/GraphDatabaseTreeItem";
import { GraphTreeItem } from "./tree/GraphTreeItem";

export function registerGraphCommands(): void {
    registerCommand('cosmosDB.createGraphDatabase', createGraphDatabase);
    registerCommand('cosmosDB.createGraph', createGraph);
    registerCommand('cosmosDB.deleteGraphDatabase', async (context: IActionContext, node?: GraphDatabaseTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = <GraphDatabaseTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(GraphDatabaseTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.deleteGraph', async (context: IActionContext, node?: GraphCollectionTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = <GraphCollectionTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(GraphCollectionTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.openGraphExplorer', async (context: IActionContext, node: GraphTreeItem) => {
        if (!node) {
            node = <GraphTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(GraphTreeItem.contextValue, context);
        }
        await node.showExplorer(context);
    }, doubleClickDebounceDelay);
}

export async function createGraphDatabase(context: IActionContext, node?: GraphAccountTreeItem): Promise<void> {
    if (!node) {
        node = <GraphAccountTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(GraphAccountTreeItem.contextValue, context);
    }
    await node.createChild(context);
}

export async function createGraph(context: IActionContext, node?: GraphDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = <GraphDatabaseTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(GraphDatabaseTreeItem.contextValue, context);
    }
    await node.createChild(context);
}
