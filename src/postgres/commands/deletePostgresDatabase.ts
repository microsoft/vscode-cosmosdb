/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, IActionContext, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";

export async function deletePostgresDatabase(context: IActionContext, node?: PostgresDatabaseTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }
    const message: string = localize('deletesPostgresDatabase', 'Are you sure you want to delete database "{0}"?', node.databaseName);
    const result = await context.ui.showWarningMessage(message, { modal: true, stepName: 'deletePostgresDatabase' }, DialogResponses.deleteResponse);
    if (result === DialogResponses.deleteResponse) {
        await node.deleteTreeItem(context);
    }
    const deleteMessage: string = localize('deletePostgresDatabaseMsg', 'Successfully deleted database "{0}".', node.databaseName);
    void vscode.window.showInformationMessage(deleteMessage);
    ext.outputChannel.appendLog(deleteMessage);
}
