/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, registerCommand } from "vscode-azureextensionui";
import { ext } from '../extensionVariables';
import { PostgresDatabaseTreeItem } from "./tree/PostgresDatabaseTreeItem";

export function registerPostgresCommands(): void {
    registerCommand('cosmosDB.deletePostgresDatabase', async (context: IActionContext, node?: PostgresDatabaseTreeItem) => {
        if (!node) {
            node = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
}
