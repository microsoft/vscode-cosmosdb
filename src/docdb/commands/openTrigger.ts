/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";
import { DocDBTriggerTreeItem } from "../tree/DocDBTriggerTreeItem";
import { pickDocDBAccount } from "./pickDocDBAccount";

export async function openTrigger(context: IActionContext, node?: DocDBTriggerTreeItem) {
    if (!node) {
        node = await pickDocDBAccount<DocDBTriggerTreeItem>(context, DocDBTriggerTreeItem.contextValue);
    }
    await ext.fileSystem.showTextDocument(node);
}
