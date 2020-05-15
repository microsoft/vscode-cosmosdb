/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import * as vscodeUtil from '../../utils/vscodeUtils';
import { PostgresFunctionTreeItem } from "../tree/PostgresFunctionTreeItem";
import { postgresBaseFileName, postgresFileExtension } from "./registerPostgresCommands";

export async function openPostgresFunction(context: IActionContext, treeItem?: PostgresFunctionTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresFunctionTreeItem>await ext.tree.showTreeItemPicker(PostgresFunctionTreeItem.contextValue, context);
    }

    const fileName: string = `${treeItem.label}-${postgresBaseFileName}`;
    await vscodeUtil.showNewFile(treeItem.definition, fileName, postgresFileExtension);
}
