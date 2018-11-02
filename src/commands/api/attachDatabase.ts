/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';
import { getDatabaseNameFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { AttachedAccountsTreeItem, getServerIdFromConnectionString } from '../../tree/AttachedAccountsTreeItem';
import { CosmosDBDatabase } from '../../vscode-cosmosdb.api';

export async function attachDatabase(databaseInfo: { connectionString: string }): Promise<CosmosDBDatabase | undefined> {
    const connectionString = databaseInfo.connectionString;

    try {
        const accountName = await getServerIdFromConnectionString(connectionString);
        const attachedAccountsNode = <AttachedAccountsTreeItem>(await ext.tree.getChildren()).find((subscription) => {
            return (subscription.id === 'cosmosDBAttachedAccounts');
        });
        const treeItemId = await attachedAccountsNode.attachNewDatabase(connectionString);
        await attachedAccountsNode.refresh();
        return {
            accountName: accountName,
            connectionString: connectionString,
            databaseName: getDatabaseNameFromConnectionString(connectionString),
            treeItemId: treeItemId
        };
    } catch (e) {
        return {
            accountName: String(e),
            connectionString: connectionString,
            databaseName: getDatabaseNameFromConnectionString(connectionString),
            treeItemId: ''
        };
    }
}
