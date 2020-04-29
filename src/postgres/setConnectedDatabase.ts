/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from "../extensionVariables";
import { PostgresDatabaseTreeItem } from "./tree/PostgresDatabaseTreeItem";

export function setConnectedDatabase(treeItem: PostgresDatabaseTreeItem | undefined): void {
    ext.connectedPostgresDB = treeItem;
    const database = treeItem && treeItem.label;
    if (ext.postgresCodeLensProvider) {
        ext.postgresCodeLensProvider.setConnectedDatabase(database);
    }
}
