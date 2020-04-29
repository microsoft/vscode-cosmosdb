/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { setConnectedDatabase } from "../setConnectedDatabase";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { connectedDBKey } from "./registerPostgresCommands";

export async function connectPostgresDatabase(context: IActionContext, treeItem?: PostgresDatabaseTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    const oldTreeItemId: string | undefined = ext.connectedMongoDB && ext.connectedMongoDB.fullId;
    ext.context.globalState.update(connectedDBKey, treeItem.fullId);
    setConnectedDatabase(treeItem);
    await treeItem.refresh();

    if (oldTreeItemId) {
        // We have to use findTreeItem to get the instance of the old tree item that's being displayed in the ext.tree. Our specific instance might have been out-of-date
        const oldTreeItem: AzureTreeItem | undefined = await ext.tree.findTreeItem(oldTreeItemId, context);
        if (oldTreeItem) {
            await oldTreeItem.refresh();
        }
    }
}
