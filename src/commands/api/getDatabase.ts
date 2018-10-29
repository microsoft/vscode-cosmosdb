/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureParentTreeItem } from 'vscode-azureextensionui';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBDatabase } from '../../vscode-cosmosdb.api';

export async function getDatabase(connectionInfo: CosmosDBDatabase): Promise<CosmosDBDatabase> {
    const connectionString = connectionInfo.connectionString;
    if (connectionString) {
        const subscriptions = await ext.tree.getChildren();
        for (const subscription of subscriptions) {
            if (subscription instanceof AzureParentTreeItem) {
                const accounts = await subscription.getCachedChildren();
                for (const account of accounts) {
                    if (account instanceof AzureParentTreeItem) {
                        const databases = await account.getCachedChildren();
                        for (const database of databases) {
                            if ((database instanceof MongoDatabaseTreeItem || database instanceof DocDBDatabaseTreeItemBase) && database.connectionString === connectionString) {
                                return {
                                    accountName: account.label,
                                    connectionString: connectionString,
                                    treeItemId: database.fullId,
                                    databaseName: database.label
                                };
                            }
                        }
                    }
                }
            }
        }
    }
    return undefined;
}
