/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { PostgresTableTreeItem } from "../tree/PostgresTableTreeItem";

export async function deletePostgresTable(context: IActionContext, node?: PostgresTableTreeItem): Promise<void> {
    if (!node) {
        node = <PostgresTableTreeItem>await ext.tree.showTreeItemPicker(PostgresTableTreeItem.contextValue, context);
    }
    const message = localize('deletesPostgresTable', 'Are you sure you want to delete table "{0}"?', node.label);
    const result = await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse);
    if (result === DialogResponses.deleteResponse) {
        await node.deleteTreeItem(context);
    }
}
