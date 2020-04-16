/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";

export async function deletePostgresDatabase(context: IActionContext, node?: PostgresDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }
    const message = localize('confirmPostgresDatabaseDeletion', 'Are you sure you want to delete database "{0}"?', node.databaseName);
    const result = await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse);
    if (result === DialogResponses.deleteResponse) {
        await node.deleteTreeItem(context);
    }
}
