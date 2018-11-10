/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';
import { getDatabaseNameFromConnectionString, getHostPortFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { AttachedAccountsTreeItem } from '../../tree/AttachedAccountsTreeItem';
import { DatabaseTreeItem, TreeItemQuery } from '../../vscode-cosmosdb.api';
import { reveal } from './reveal';

function isParentAccount(connectionString: string, account: MongoAccountTreeItem): boolean {
    const databaseHostPort = getHostPortFromConnectionString(connectionString);
    const accountHostPort = getHostPortFromConnectionString(account.connectionString);
    return (databaseHostPort === accountHostPort);
}

export async function findTreeItem(query: TreeItemQuery, attachedAccountsNode: AttachedAccountsTreeItem): Promise<DatabaseTreeItem | undefined> {
    const connectionString = query.connectionString;

    if (/^mongodb[^:]*:\/\//i.test(connectionString)) {
        const hostport = await getHostPortFromConnectionString(connectionString);
        const accounts = await attachedAccountsNode.getCachedChildren();
        for (const account of accounts) {
            if ((account instanceof MongoAccountTreeItem) && isParentAccount(connectionString, account)) {
                const databases = await account.getCachedChildren();
                for (const database of databases) {
                    if ((database instanceof MongoDatabaseTreeItem) && getDatabaseNameFromConnectionString(connectionString) === getDatabaseNameFromConnectionString(database.connectionString)) {
                        return {
                            connectionString: connectionString,
                            databaseName: database.databaseName,
                            hostName: hostport.host,
                            port: hostport.port,
                            reveal: async () => await ext.treeView.reveal(database)
                        };
                    }
                }
            }
        }

        let fullId: string | undefined;
        return {
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
    }

    return undefined;
}
