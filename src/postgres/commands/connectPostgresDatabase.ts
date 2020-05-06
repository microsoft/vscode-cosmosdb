/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { connectedPostgresKey } from "./registerPostgresCommands";

export async function connectPostgresDatabase(context: IActionContext, treeItem?: PostgresDatabaseTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    const oldTreeItemId: string | undefined = ext.connectedPostgresDB && ext.connectedPostgresDB.fullId;
    ext.context.globalState.update(connectedPostgresKey, treeItem.fullId);
    ext.connectedPostgresDB = treeItem;
    const database = treeItem && treeItem.label;
    if (ext.postgresCodeLensProvider) {
        ext.postgresCodeLensProvider.setConnectedDatabase(database);
    }
    await treeItem.refresh();

    if (oldTreeItemId) {
        // We have to use findTreeItem to get the instance of the old tree item that's being displayed in the ext.tree. Our specific instance might have been out-of-date
        const oldTreeItem: AzureTreeItem | undefined = await ext.tree.findTreeItem(oldTreeItemId, context);
        if (oldTreeItem) {
            await oldTreeItem.refresh();
        }
    }
}
