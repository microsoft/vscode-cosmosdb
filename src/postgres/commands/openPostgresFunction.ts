/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "vscode-azureextensionui";
import { CosmosEditorManager } from "../../CosmosEditorManager";
import { ext } from "../../extensionVariables";
import { PostgresFunctionEditor } from "../editors/PostgresFunctionEditor";
import { PostgresFunctionTreeItem } from "../tree/PostgresFunctionTreeItem";

export async function openPostgresFunction(editorManager: CosmosEditorManager, context: IActionContext, treeItem?: PostgresFunctionTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresFunctionTreeItem>await ext.tree.showTreeItemPicker(PostgresFunctionTreeItem.contextValue, context);
    }

    const fileName: string = `${treeItem.label} (${treeItem.parent.parent.parent.server.name}.${treeItem.schema}).sql`;
    await editorManager.showDocument(context, new PostgresFunctionEditor(treeItem), fileName);
}
