/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { MongoCollectionTreeItem } from "../mongo/tree/MongoCollectionTreeItem";
import * as vscodeUtil from "../utils/vscodeUtils";

export async function writeNoSqlQuery(_context: IActionContext, node: MongoCollectionTreeItem): Promise<void> {
    await vscodeUtil.showNewFile("", `query for ${node.label}`, ".nosql");
}
