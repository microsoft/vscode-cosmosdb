/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands } from "vscode";
import { IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { PostgresFunctionsTreeItem } from "../tree/PostgresFunctionsTreeItem";

export async function createPostgresFunction(context: IActionContext, treeItem?: PostgresFunctionsTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresFunctionsTreeItem>await ext.tree.showTreeItemPicker(PostgresFunctionsTreeItem.contextValue, context);
    }

    const child = await treeItem.createChild(context);
    await commands.executeCommand("cosmosDB.openPostgresFunction", child);
}
