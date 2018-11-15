/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem } from 'vscode-azureextensionui';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { parseMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { CosmosDBAccountProvider } from '../../tree/CosmosDBAccountProvider';
import { DatabaseAccountTreeItem, DatabaseTreeItem, TreeItemQuery } from '../../vscode-cosmosdb.api';
import { cacheTreeItem, tryGetTreeItemFromCache } from './apiCache';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';
import { DatabaseTreeItemInternal } from './DatabaseTreeItemInternal';

export async function findTreeItem(query: TreeItemQuery): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
    const connectionString = query.connectionString;
    let parsedCS: ParsedConnectionString;
    if (/^mongodb[^:]*:\/\//i.test(connectionString)) {
        parsedCS = await parseMongoConnectionString(connectionString);
    } else {
        parsedCS = parseDocDBConnectionString(connectionString);
    }

    const maxTime = Date.now() + 10 * 1000; // Give up searching subscriptions after 10 seconds and just attach the account

    // 1. Get result from cache if possible
    let result: DatabaseAccountTreeItem | DatabaseTreeItem | undefined = tryGetTreeItemFromCache(parsedCS);

    // 2. Search attached accounts (do this before subscriptions because it's faster)
    if (!result) {
        const attachedDbAccounts = await ext.attachedAccountsNode.getCachedChildren();
        result = await searchDbAccounts(attachedDbAccounts, parsedCS, maxTime);
    }

    // 3. Search subscriptions
    if (!result) {
        const rootNodes = await ext.tree.getChildren();
        for (const rootNode of rootNodes) {
            if (Date.now() > maxTime) {
                break;
            }

            if (rootNode instanceof CosmosDBAccountProvider) {
                const dbAccounts = await rootNode.getCachedChildren();
                result = await searchDbAccounts(dbAccounts, parsedCS, maxTime);
                if (result) {
                    break;
                }
            }
        }
    }

    // 4. If all else fails, just attach a new node
    if (!result) {
        result = new DatabaseTreeItemInternal(parsedCS);
    }

    cacheTreeItem(parsedCS, result);

    return result;
}

async function searchDbAccounts(dbAccounts: AzureTreeItem[], expected: ParsedConnectionString, maxTime: number): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
    for (const dbAccount of dbAccounts) {
        if (Date.now() > maxTime) {
            return undefined;
        }

        let actual: ParsedConnectionString;
        if (dbAccount instanceof MongoAccountTreeItem) {
            actual = await parseMongoConnectionString(dbAccount.connectionString);
        } else if (dbAccount instanceof DocDBAccountTreeItemBase) {
            actual = parseDocDBConnectionString(dbAccount.connectionString);
        } else {
            return undefined;
        }

        if (expected.accountId === actual.accountId) {
            if (expected.databaseName) {
                const dbs = await dbAccount.getCachedChildren();
                for (const db of dbs) {
                    if ((db instanceof MongoDatabaseTreeItem || db instanceof DocDBDatabaseTreeItemBase) && expected.databaseName === db.databaseName) {
                        return new DatabaseTreeItemInternal(expected, dbAccount, db);
                    }
                }

                // We found the right account - just not the db. In this case we can still 'reveal' the account
                return new DatabaseTreeItemInternal(expected, dbAccount);
            }

            return new DatabaseAccountTreeItemInternal(expected, dbAccount);
        }
    }

    return undefined;
}
