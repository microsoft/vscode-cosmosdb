/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocDBDatabaseTreeItem } from '../../docdb/tree/DocDBDatabaseTreeItem';
import { ext } from '../../extensionVariables';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';

export async function getConnectionString(treeItemId: string): Promise<string> {
    const node = await ext.tree.findTreeItem(treeItemId);
    if (!node) {
        throw new Error(`Couldn't find the database node in Cosmos DB with provided Id: ${treeItemId}`);
    }

    if (node instanceof MongoDatabaseTreeItem || node instanceof DocDBDatabaseTreeItem) {
        return node.connectionString;
    } else {
        throw new Error('Not implemented yet. For now works only with Mongo.');
    }
}
