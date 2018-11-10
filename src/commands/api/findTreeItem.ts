/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureParentTreeItem } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { getDatabaseNameFromConnectionString, getHostPortFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { AttachedAccountsTreeItem } from '../../tree/AttachedAccountsTreeItem';
import { DatabaseTreeItem, TreeItemQuery } from '../../vscode-cosmosdb.api';
import { reveal } from './reveal';

async function isParentAccount(connectionString: string, account: MongoAccountTreeItem): Promise<boolean> {
    const databaseHostPort = await getHostPortFromConnectionString(connectionString);
    const accountHostPort = await getHostPortFromConnectionString(account.connectionString);
    return (databaseHostPort.host === accountHostPort.host && databaseHostPort.port === accountHostPort.port);
}

export async function findTreeItem(query: TreeItemQuery, attachedAccountsNode: AttachedAccountsTreeItem): Promise<DatabaseTreeItem | undefined> {
    const connectionString = query.connectionString;

    if (/^mongodb[^:]*:\/\//i.test(connectionString)) {
        const hostport = await getHostPortFromConnectionString(connectionString);

        //Look into attached accounts at the first
        const subscriptions = (await ext.tree.getChildren()).filter((subscription) => {
            return (subscription !== attachedAccountsNode);
        });
        subscriptions.unshift(attachedAccountsNode);
        for (const subscription of subscriptions) {
            if (subscription instanceof AzureParentTreeItem) {
                const accounts = await subscription.getCachedChildren();
                for (const account of accounts) {
                    if ((account instanceof MongoAccountTreeItem) && (await isParentAccount(connectionString, account))) {
                        const databases = await account.getCachedChildren();
                        for (const database of databases) {
                            if ((database instanceof MongoDatabaseTreeItem) && connectionString === database.connectionString) {
                                return {
                                    connectionString: connectionString,
                                    databaseName: database.databaseName,
                                    hostName: hostport.host,
                                    port: hostport.port,
                                    azureData: database.parent.databaseAccount ? { accountName: database.parent.databaseAccount.name } : undefined,
                                    reveal: async () => await ext.treeView.reveal(database)
                                };
                            }
                        }
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
