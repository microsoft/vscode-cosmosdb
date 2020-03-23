/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "vscode-azureextensionui";
import { ext } from "../extensionVariables";
import { PostgresDatabaseTreeItem } from "./tree/PostgresDatabaseTreeItem";
import { PostgresEnterCredentialsTreeItem } from "./tree/PostgresEnterCredentialsTreeItem";

export async function getPostgresCredentials(context: IActionContext, treeItem?: PostgresDatabaseTreeItem | PostgresEnterCredentialsTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    if (treeItem instanceof PostgresEnterCredentialsTreeItem) {
        treeItem = treeItem.parent;
    }

    await treeItem.getCredentials(true, false);
    await treeItem.refresh();
}
