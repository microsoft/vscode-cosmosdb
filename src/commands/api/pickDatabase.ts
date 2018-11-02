/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBDatabase } from '../../vscode-cosmosdb.api';

export async function pickDatabase(): Promise<CosmosDBDatabase> {
    const pickedDatabase = <MongoDatabaseTreeItem>(await ext.tree.showTreeItemPicker([MongoDatabaseTreeItem.contextValue]));

    return {
        connectionString: pickedDatabase.connectionString,
        treeItemId: pickedDatabase.fullId,
        accountName: pickedDatabase.parent.id,
        databaseName: pickedDatabase.id
    };
}
