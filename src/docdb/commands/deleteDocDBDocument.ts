/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { DocDBDocumentTreeItem } from "../tree/DocDBDocumentTreeItem";
import { pickDocDBAccount } from "./pickDocDBAccount";

export async function deleteDocDBDocument(context: IActionContext, node?: DocDBDocumentTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBDocumentTreeItem>(context, DocDBDocumentTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}
