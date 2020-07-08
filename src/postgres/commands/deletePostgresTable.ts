/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { window } from 'vscode';
import { DialogResponses, IActionContext, ITreeItemPickerContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { PostgresTableTreeItem } from "../tree/PostgresTableTreeItem";

export async function deletePostgresTable(context: IActionContext, node?: PostgresTableTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = <PostgresTableTreeItem>await ext.tree.showTreeItemPicker(PostgresTableTreeItem.contextValue, context);
    }
    const message: string = localize('deletesPostgresTable', 'Are you sure you want to delete table "{0}"?', node.label);
    await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse);
    await node.deleteTreeItem(context);
    const deleteMessage: string = localize('successfullyDeletedTable', 'Successfully deleted table "{0}".', node.label);
    window.showInformationMessage(deleteMessage);
    ext.outputChannel.appendLog(deleteMessage);
}
