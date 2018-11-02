/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureParentTreeItem } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { addDatabaseToAccountConnectionString, getDatabaseNameFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { getServerIdFromConnectionString } from '../../tree/AttachedAccountsTreeItem';
import { CosmosDBDatabase } from '../../vscode-cosmosdb.api';

function isParentAccount(connectionString: string, account: MongoAccountTreeItem): boolean {
    const mongoAccountString = addDatabaseToAccountConnectionString(account.connectionString, '');
    // Mongo database connection string will always contian '/' after addDatabaseToAccountConnectionString method, but account connection string can be without in this case: mongodb://localhost
    if (mongoAccountString.startsWith(account.connectionString)) {
        return true;
    }

    // In case if database was attached, it's connection strings will be the same
    const attachedAccount = addDatabaseToAccountConnectionString(account.connectionString, '');
    const attachedDatabase = addDatabaseToAccountConnectionString(connectionString, '');
    return (attachedAccount === attachedDatabase);
}

export async function getDatabase(searchCriteria: { connectionString: string }): Promise<CosmosDBDatabase | undefined> {
    const connectionString = searchCriteria.connectionString;
    if (/^mongodb[^:]*:\/\//i.test(connectionString)) {
        //Look into attached accounts at the first
        const attachedAccountsNode = (await ext.tree.getChildren()).find((subscription) => {
            return (subscription.id === 'cosmosDBAttachedAccounts');
        });
        const subscriptions = (await ext.tree.getChildren()).filter((subscription) => {
            return (subscription !== attachedAccountsNode);
        });
        subscriptions.unshift(attachedAccountsNode);

        for (const subscription of subscriptions) {
            if (subscription instanceof AzureParentTreeItem) {
                const accounts = await subscription.getCachedChildren();
                for (const account of accounts) {
                    if ((account instanceof MongoAccountTreeItem) && isParentAccount(connectionString, account)) {
                        const databases = await account.getCachedChildren();
                        for (const database of databases) {
                            if ((database instanceof MongoDatabaseTreeItem) && connectionString === database.connectionString) {
                                return {
                                    accountName: account.name,
                                    connectionString: connectionString,
                                    databaseName: database.databaseName,
                                    treeItemId: database.fullId
                                };
                            }
                        }
                    }
                }
            }
        }

        let accountName;
        try {
            accountName = await getServerIdFromConnectionString(connectionString);
        } catch (e) {
            accountName = String(e);
        }
        return {
            accountName: accountName,
            connectionString: connectionString,
            databaseName: getDatabaseNameFromConnectionString(connectionString),
            treeItemId: ''
        };
    }

    return undefined;
}
