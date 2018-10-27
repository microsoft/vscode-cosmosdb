/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocDBDatabaseTreeItem } from '../../docdb/tree/DocDBDatabaseTreeItem';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBItem } from '../../vscode-cosmosdb.api';

export async function pickDatabase(): Promise<CosmosDBItem> {
    const pickedDatabase = (await ext.tree.showTreeItemPicker([MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue]));

    if (pickedDatabase instanceof MongoDatabaseTreeItem || pickedDatabase instanceof DocDBDatabaseTreeItemBase) {
        return {
            connectionString: pickedDatabase.connectionString,
            cosmosDBTreeItemId: pickedDatabase.fullId,
            accountName: pickedDatabase.parent.label,
            databaseName: pickedDatabase.label
        };
    }

    throw new Error(`For now, supports only MongoDB and DocDB.`);
}
