/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DialogResponses, IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';

export async function deletePostgresServer(context: IActionContext, node?: PostgresServerTreeItem): Promise<void> {
    if (!node) {
        node = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }
    const message: string = localize('confirmServerDeletion', 'Are you sure you want to delete server "{0}" and its contents?', node.name);
    const result = await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse);
    if (result === DialogResponses.deleteResponse) {
        await node.deleteTreeItem(context);
        vscode.window.showInformationMessage(localize('serverDeletedMessage', 'Successfully deleted server "{0}".', node.name));
    }
}
