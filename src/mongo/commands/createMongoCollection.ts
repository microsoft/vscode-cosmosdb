/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { MongoDatabaseTreeItem } from "../tree/MongoDatabaseTreeItem";
import { pickMongo } from "./pickMongo";

export async function createMongoCollection(context: IActionContext, node?: MongoDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = await pickMongo<MongoDatabaseTreeItem>(context, MongoDatabaseTreeItem.contextValue);
    }
    const collectionNode = await node.createChild(context);
    await vscode.commands.executeCommand('cosmosDB.connectMongoDB', collectionNode.parent);
}
