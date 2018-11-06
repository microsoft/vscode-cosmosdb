/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttachedAccountsTreeItem } from 'src/tree/AttachedAccountsTreeItem';
import { ext } from '../../extensionVariables';
import { addDatabaseToAccountConnectionString, getDatabaseNameFromConnectionString, getHostPortFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBTreeItem, TreeItemQuery } from '../../vscode-cosmosdb.api';
import { reveal } from './reveal';

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

export async function findTreeItem<T extends CosmosDBTreeItem>(query: TreeItemQuery): Promise<T | undefined> {
    const connectionString = query.connectionString;

    if (/^mongodb[^:]*:\/\//i.test(connectionString)) {
        const hostport = await getHostPortFromConnectionString(connectionString);

        //Look into attached accounts first
        const attachedAccountsNode = <AttachedAccountsTreeItem>(await ext.tree.getChildren()).find((subscription) => {
            return (subscription.id === 'cosmosDBAttachedAccounts');
        });

        const accounts = await attachedAccountsNode.getCachedChildren();
        for (const account of accounts) {
            if ((account instanceof MongoAccountTreeItem) && isParentAccount(connectionString, account)) {
                const databases = await account.getCachedChildren();
                for (const database of databases) {
                    if ((database instanceof MongoDatabaseTreeItem) && connectionString === database.connectionString) {
                        // Temporary name
                        const res1 = {
                            connectionString: connectionString,
                            databaseName: database.databaseName,
                            hostName: hostport.host,
                            port: hostport.port,
                            reveal: () => reveal(database.fullId)
                        };
                        return res1;
                    }
                }
            }
        }

        let fullId: string | undefined;
        // Temporary name
        const res2 = {
            connectionString: connectionString,
            databaseName: getDatabaseNameFromConnectionString(connectionString),
            hostName: hostport.host,
            port: hostport.port,
            reveal: async () => {
                if (!fullId) {
                    fullId = await attachedAccountsNode.attachNewDatabase(connectionString);
                    await attachedAccountsNode.refresh();
                }
                reveal(fullId);
            }
        };
        return res2;
    }

    return undefined;
}
