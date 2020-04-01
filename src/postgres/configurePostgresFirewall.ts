/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericTreeItem, IActionContext } from "vscode-azureextensionui";
import { ext } from "../extensionVariables";
import { nonNullProp } from "../utils/nonNull";
import { PostgresServerTreeItem } from "./tree/PostgresServerTreeItem";

export async function configurePostgresFirewall(context: IActionContext, treeItem?: PostgresServerTreeItem | GenericTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    } else if (treeItem instanceof GenericTreeItem) {
        treeItem = nonNullProp(nonNullProp(treeItem, 'parent'), 'parent');
    }

    await (<PostgresServerTreeItem>treeItem).configureFirewall();
    await treeItem.refresh();
}
