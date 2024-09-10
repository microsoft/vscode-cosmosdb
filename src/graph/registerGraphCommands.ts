/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    registerCommandWithTreeNodeUnwrapping,
    type AzExtTreeItem,
    type IActionContext,
    type ITreeItemPickerContext,
} from '@microsoft/vscode-azext-utils';
import { cosmosGremlinFilter, doubleClickDebounceDelay } from '../constants';
import { ext } from '../extensionVariables';
import { type GraphAccountTreeItem } from './tree/GraphAccountTreeItem';
import { GraphCollectionTreeItem } from './tree/GraphCollectionTreeItem';
import { GraphDatabaseTreeItem } from './tree/GraphDatabaseTreeItem';
import { GraphTreeItem } from './tree/GraphTreeItem';

export function registerGraphCommands(): void {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createGraphDatabase', createGraphDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createGraph', createGraph);
    registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.deleteGraphDatabase',
        async (context: IActionContext, node?: GraphDatabaseTreeItem) => {
            const suppressCreateContext: ITreeItemPickerContext = context;
            suppressCreateContext.suppressCreatePick = true;
            if (!node) {
                node = await pickGraph<GraphDatabaseTreeItem>(context, GraphDatabaseTreeItem.contextValue);
            }
            await node.deleteTreeItem(context);
        },
    );
    registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.deleteGraph',
        async (context: IActionContext, node?: GraphCollectionTreeItem) => {
            const suppressCreateContext: ITreeItemPickerContext = context;
            suppressCreateContext.suppressCreatePick = true;
            if (!node) {
                node = await pickGraph<GraphCollectionTreeItem>(context, GraphCollectionTreeItem.contextValue);
            }
            await node.deleteTreeItem(context);
        },
    );
    registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.openGraphExplorer',
        async (context: IActionContext, node: GraphTreeItem) => {
            if (!node) {
                node = await pickGraph<GraphTreeItem>(context, GraphTreeItem.contextValue);
            }
            await node.showExplorer(context);
        },
        doubleClickDebounceDelay,
    );
}

export async function createGraphDatabase(context: IActionContext, node?: GraphAccountTreeItem): Promise<void> {
    if (!node) {
        node = await pickGraph<GraphAccountTreeItem>(context);
    }
    await node.createChild(context);
}

export async function createGraph(context: IActionContext, node?: GraphDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = await pickGraph<GraphDatabaseTreeItem>(context, GraphDatabaseTreeItem.contextValue);
    }
    await node.createChild(context);
}

async function pickGraph<T extends AzExtTreeItem>(
    context: IActionContext,
    expectedContextValue?: string | RegExp | (string | RegExp)[],
): Promise<T> {
    return await ext.rgApi.pickAppResource<T>(context, {
        filter: [cosmosGremlinFilter],
        expectedChildContextValue: expectedContextValue,
    });
}
