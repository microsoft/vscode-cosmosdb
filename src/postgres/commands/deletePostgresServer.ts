/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DialogResponses, IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';

export async function deletePostgresServer(context: IActionContext, node?: PostgresServerTreeItem): Promise<void> {
    if (!node) {
        node = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }
    const message: string = `Are you sure you want to delete server "${node.name}" and its contents?`;
    const result = await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse);
    if (result === DialogResponses.deleteResponse) {
        await node.deleteTreeItem(context);
        vscode.window.showInformationMessage(`Successfully deleted server "${node.name}".`);
    }
}
