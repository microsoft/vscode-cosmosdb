/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri, window } from 'vscode';
import { AzureTreeItem, IActionContext } from "vscode-azureextensionui";
import { connectedPostgresKey } from '../../constants';
import { ext } from "../../extensionVariables";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";

export async function connectPostgresDatabase(context: IActionContext, treeItem?: Uri | PostgresDatabaseTreeItem): Promise<void> {
    if (!treeItem || treeItem instanceof Uri) {
        if (treeItem) {
            void window.showTextDocument(treeItem);
        }

        treeItem = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    const oldTreeItemId: string | undefined = ext.connectedPostgresDB && ext.connectedPostgresDB.fullId;
    void ext.context.globalState.update(connectedPostgresKey, treeItem.fullId);
    ext.connectedPostgresDB = treeItem;
    const username: string | undefined = (await treeItem.parent.getFullConnectionString()).username;
    const serverId: string = treeItem.parent.id;
    let serverName: string | undefined = serverId;
    if (username) {
        serverName = username.includes(serverId) ? username : username + `@{serverId}`;
    }
    const database = treeItem && treeItem.label;

    if (ext.postgresCodeLensProvider) {
        ext.postgresCodeLensProvider.setConnectedDatabase(database, serverName);
    }
    await treeItem.refresh(context);

    if (oldTreeItemId) {
        // We have to use findTreeItem to get the instance of the old tree item that's being displayed in the ext.tree. Our specific instance might have been out-of-date
        const oldTreeItem: AzureTreeItem | undefined = await ext.tree.findTreeItem(oldTreeItemId, context);
        if (oldTreeItem) {
            await oldTreeItem.refresh(context);
        }
    }
}
