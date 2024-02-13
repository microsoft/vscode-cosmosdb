/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscodeUtil from "../../utils/vscodeUtils";
import { DocDBCollectionTreeItem } from "../tree/DocDBCollectionTreeItem";
import { setConnectedNoSqlContainer } from "./connectNoSqlContainer";

export async function writeNoSqlQuery(_context: IActionContext, node: DocDBCollectionTreeItem): Promise<void> {
    setConnectedNoSqlContainer(node);
    const sampleQuery = `SELECT * FROM ${node.id}`;
    await vscodeUtil.showNewFile(sampleQuery, `query for ${node.label}`, ".nosql");
}
