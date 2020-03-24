/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericTreeItem, IActionContext } from "vscode-azureextensionui";
import { ext } from "../extensionVariables";
import { PostgresDatabaseTreeItem } from "./tree/PostgresDatabaseTreeItem";

export async function getPostgresCredentials(context: IActionContext, treeItem?: PostgresDatabaseTreeItem | GenericTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    if (treeItem instanceof GenericTreeItem) {
        treeItem = treeItem.parent;
    }

    await (<PostgresDatabaseTreeItem>treeItem).getCredentials(true, false);
    await treeItem.refresh();
}
