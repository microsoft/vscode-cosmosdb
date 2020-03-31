/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, IActionContext, registerCommand } from "vscode-azureextensionui";
import { ext } from '../../extensionVariables';
import { PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';

// tslint:disable-next-line: max-func-body-length
export function registerPostgresCommands(): void {

    registerCommand('cosmosDB.deletePostgresAccount', async (actionContext: IActionContext, node?: AzureTreeItem) => {
        if (!node) {
            node = await ext.tree.showTreeItemPicker<AzureTreeItem>(PostgresServerTreeItem.contextValue, actionContext);
        }

        await node.deleteTreeItem(actionContext);
    });
}
