/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { KeyValueStore } from "../../KeyValueStore";
import { ext } from "../../extensionVariables";
import { NoSqlQueryConnection, noSqlQueryConnectionKey } from "../NoSqlCodeLensProvider";
import { DocDBCollectionTreeItem } from "../tree/DocDBCollectionTreeItem";
import { pickDocDBAccount } from "./pickDocDBAccount";

export function setConnectedNoSqlContainer(node: DocDBCollectionTreeItem): void {
    const noSqlQueryConnection: NoSqlQueryConnection = {
        databaseId: node.parent.id,
        containerId: node.id,
        endpoint: node.root.endpoint,
        masterKey: node.root.masterKey,
        isEmulator: !!node.root.isEmulator
    };
    KeyValueStore.instance.set(noSqlQueryConnectionKey, noSqlQueryConnection);
    ext.noSqlCodeLensProvider.updateCodeLens();
}

export async function connectNoSqlContainer(context: IActionContext): Promise<void> {
    const node = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
    setConnectedNoSqlContainer(node);
}
