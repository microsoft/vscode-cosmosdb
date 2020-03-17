/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext, IParsedError, parseError } from 'vscode-azureextensionui';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { parseMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { SubscriptionTreeItem } from '../../tree/SubscriptionTreeItem';
import { DatabaseAccountTreeItem, DatabaseTreeItem, TreeItemQuery } from '../../vscode-cosmosdb.api';
import { cacheTreeItem, tryGetTreeItemFromCache } from './apiCache';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';
import { DatabaseTreeItemInternal } from './DatabaseTreeItemInternal';

export async function findTreeItem(query: TreeItemQuery): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
    return await callWithTelemetryAndErrorHandling('api.findTreeItem', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = true;

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
            const attachedDbAccounts = await ext.attachedAccountsNode.getCachedChildren(context);

            try {
                result = await searchDbAccounts(attachedDbAccounts, parsedCS, context, maxTime);
            } catch (error) {
                const parsedError: IParsedError = parseError(error);
                if (!parsedCS.accountId.includes('127.0.0.1') && parsedError.message.includes('127.0.0.1') && parsedError.errorType === 'MongoNetworkError') {
                    // Ignore this error since the emulated account isn't being searched for
                    // https://github.com/microsoft/vscode-cosmosdb/issues/966
                } else {
                    throw error;
                }
            }
        }

        // 3. Search subscriptions
        if (!result) {
            const rootNodes = await ext.tree.getChildren();
            for (const rootNode of rootNodes) {
                if (Date.now() > maxTime) {
                    break;
                }

                if (rootNode instanceof SubscriptionTreeItem) {
                    const dbAccounts = await rootNode.getCachedChildren(context);
                    result = await searchDbAccounts(dbAccounts, parsedCS, context, maxTime);
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
    });
}

async function searchDbAccounts(dbAccounts: AzExtTreeItem[], expected: ParsedConnectionString, context: IActionContext, maxTime: number): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
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
                const dbs = await dbAccount.getCachedChildren(context);
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
