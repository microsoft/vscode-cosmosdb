/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { pickMongo } from "./pickMongo";

export async function deleteMongoDocument(context: IActionContext, node?: MongoDocumentTreeItem) {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickMongo<MongoDocumentTreeItem>(context, MongoDocumentTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}
