/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';
import { MongoDatabaseTreeItem } from './tree/MongoDatabaseTreeItem';

export function setConnectedNode(node: MongoDatabaseTreeItem | undefined): void {
    ext.connectedMongoDB = node;
    const dbName = node && node.label;
    ext.mongoCodeLensProvider.setConnectedDatabase(dbName);
}
