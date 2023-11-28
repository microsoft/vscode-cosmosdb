/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { KeyValueStore } from "../KeyValueStore";
import { ext } from "../extensionVariables";
import * as vscodeUtil from "../utils/vscodeUtils";
import { NoSqlQueryConnection, noSqlQueryConnectionKey } from "./NoSqlCodeLensProvider";
import { DocDBCollectionTreeItem } from "./tree/DocDBCollectionTreeItem";

export async function writeNoSqlQuery(_context: IActionContext, node: DocDBCollectionTreeItem): Promise<void> {
    const noSqlQueryConnection: NoSqlQueryConnection = {
        databaseId: node.parent.id,
        containerId: node.id,
        endpoint: node.root.endpoint,
        masterKey: node.root.masterKey,
        isEmulator: !!node.root.isEmulator
    };
    KeyValueStore.instance.set(noSqlQueryConnectionKey, noSqlQueryConnection);
    ext.noSqlCodeLensProvider.updateCodeLens();
    const sampleQuery = `SELECT * FROM ${noSqlQueryConnection.containerId}`;
    await vscodeUtil.showNewFile(sampleQuery, `query for ${node.label}`, ".nosql");
}
