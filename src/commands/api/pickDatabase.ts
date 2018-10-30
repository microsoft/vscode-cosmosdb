/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttachedAccountsTreeItem } from 'src/tree/AttachedAccountsTreeItem';
import { ext } from '../../extensionVariables';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBDatabase } from '../../vscode-cosmosdb.api';

export async function pickDatabase(): Promise<CosmosDBDatabase> {
    const pickedDatabase = (await ext.tree.showTreeItemPicker([MongoDatabaseTreeItem.contextValue]));

    const attachedAccountsNode = <AttachedAccountsTreeItem | undefined>(await ext.tree.getChildren()).find((subscription) => {
        return (subscription.id === 'cosmosDBAttachedAccounts');
    });

    if (pickedDatabase instanceof MongoDatabaseTreeItem) {
        const databaseFullId = await attachedAccountsNode.attachDatabase(pickedDatabase);
        await attachedAccountsNode.refresh();
        return {
            connectionString: pickedDatabase.connectionString,
            treeItemId: databaseFullId,
            accountName: pickedDatabase.parent.label,
            databaseName: undefined
        };
    }

    throw new Error(`For now, supports only MongoDB.`);
}
