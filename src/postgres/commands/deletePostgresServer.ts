/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DialogResponses, IActionContext, ITreeItemPickerContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';

export async function deletePostgresServer(context: IActionContext, node?: PostgresServerTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }
    const message: string = localize('deleteServerConfirmPrompt', 'Are you sure you want to delete server "{0}" and its contents?', node.label);
    await context.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse);
    await node.deleteTreeItem(context);
    const deleteMessage: string = localize("deleteServerMsg", 'Successfully deleted server "{0}".', node.label);
    void vscode.window.showInformationMessage(deleteMessage);
    ext.outputChannel.appendLog(deleteMessage);
}
