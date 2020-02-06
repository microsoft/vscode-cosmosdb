/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from "../extensionVariables";
import { MongoCodeLensProvider } from "./services/MongoCodeLensProvider";
import { MongoDatabaseTreeItem } from "./tree/MongoDatabaseTreeItem";

export function setConnectedNode(node: MongoDatabaseTreeItem | undefined, codeLensProvider: MongoCodeLensProvider) {
    ext.connectedMongoDB = node;
    const dbName = node && node.label;
    if (codeLensProvider) {
        codeLensProvider.setConnectedDatabase(dbName);
    }
}
