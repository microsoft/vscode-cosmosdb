/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureParentTreeItem } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBDatabase } from '../../vscode-cosmosdb.api';

export async function getDatabase(detectionData: { connectionString: string }): Promise<CosmosDBDatabase | undefined> {
    const attachedAccountsNode = <AzureParentTreeItem | undefined>(await ext.tree.getChildren()).find((subscription) => {
        return (subscription.id === 'cosmosDBAttachedAccounts');
    });
    if (attachedAccountsNode) {
        const attachedAccounts = await attachedAccountsNode.getCachedChildren();
        for (const account of attachedAccounts) {
            if (account instanceof AzureParentTreeItem) {
                const databases = await account.getCachedChildren();
                for (const database of databases) {
                    if (database instanceof MongoDatabaseTreeItem && database.connectionString === detectionData.connectionString) {
                        return {
                            accountName: account.label,
                            connectionString: detectionData.connectionString,
                            treeItemId: database.fullId,
                            databaseName: undefined
                        };
                    }
                }
            }
        }
    }

    return undefined;
}
