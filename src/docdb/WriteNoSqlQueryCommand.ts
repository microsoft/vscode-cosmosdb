/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { KeyValueStore } from "../KeyValueStore";
import * as vscodeUtil from "../utils/vscodeUtils";
import { DocDBCollectionTreeItem } from "./tree/DocDBCollectionTreeItem";

export async function writeNoSqlQuery(_context: IActionContext, node: DocDBCollectionTreeItem): Promise<void> {
    const queryId = node.fullId;
    KeyValueStore.instance.set(queryId, {
        databaseId: node.parent.id,
        collectionId: node.id,
        endpoint: node.root.endpoint,
        masterKey: node.root.masterKey,
        isEmulator: node.root.isEmulator
    });
    const queryObject = {
        queryId: queryId,
        query: `SELECT * FROM ${node.id}`
    };
    await vscodeUtil.showNewFile(JSON.stringify(queryObject, null, 2), `query for ${node.label}`, ".nosql");
}
