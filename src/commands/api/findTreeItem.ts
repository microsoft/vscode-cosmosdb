/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext } from 'vscode-azureextensionui';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { parseMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { parsePostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { PostgresDatabaseTreeItem } from '../../postgres/tree/PostgresDatabaseTreeItem';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { SubscriptionTreeItem } from '../../tree/SubscriptionTreeItem';
import { nonNullProp } from '../../utils/nonNull';
import { DatabaseAccountTreeItem, DatabaseTreeItem, TreeItemQuery } from '../../vscode-cosmosdb.api';
import { cacheTreeItem, tryGetTreeItemFromCache } from './apiCache';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';
import { DatabaseTreeItemInternal } from './DatabaseTreeItemInternal';

export async function findTreeItem(query: TreeItemQuery): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
    return await callWithTelemetryAndErrorHandling('api.findTreeItem', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = true;

        let parsedCS: ParsedConnectionString;
        if (query.postgresData) {
            const postgresData = query.postgresData;
            let connectionString: string = `postgres://`;
            if (postgresData.username && postgresData.password) {
                const encodedUsername = encodeURIComponent(postgresData.username);
                const encodedPassword = encodeURIComponent(postgresData.password);
                connectionString += `${encodedUsername}:${encodedPassword}@`;

            }
            connectionString += `${postgresData.hostName}:${postgresData.port}`;
            if (postgresData.dbName) {
                const encodeDatabaseName = encodeURIComponent(postgresData.dbName);
                connectionString += `/${encodeDatabaseName}`;
            }
            parsedCS = parsePostgresConnectionString(connectionString);
        } else {
            const connectionString = nonNullProp(query, 'connectionString');
            if (/^mongodb[^:]*:\/\//i.test(connectionString)) {
                parsedCS = await parseMongoConnectionString(connectionString);
            } else {
                parsedCS = parseDocDBConnectionString(connectionString);
            }
        }

        const maxTime = Date.now() + 10 * 1000; // Give up searching subscriptions after 10 seconds and just attach the account

        // 1. Get result from cache if possible
        let result: DatabaseAccountTreeItem | DatabaseTreeItem | undefined = tryGetTreeItemFromCache(parsedCS);

        // 2. Search attached accounts (do this before subscriptions because it's faster)
        if (!result) {
            const attachedDbAccounts = await ext.attachedAccountsNode.getCachedChildren(context);
            result = await searchDbAccounts(attachedDbAccounts, parsedCS, context, maxTime);
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
            if (parsedCS.databaseName) {
                result = new DatabaseTreeItemInternal(parsedCS, parsedCS.databaseName);
            } else {
                result = new DatabaseAccountTreeItemInternal(parsedCS);
            }
        }

        cacheTreeItem(parsedCS, result);

        return result;
    });
}

async function searchDbAccounts(dbAccounts: AzExtTreeItem[], expected: ParsedConnectionString, context: IActionContext, maxTime: number): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
    try {
        for (const dbAccount of dbAccounts) {
            if (Date.now() > maxTime) {
                return undefined;
            }

            let actual: ParsedConnectionString;
            if (dbAccount instanceof MongoAccountTreeItem) {
                actual = await parseMongoConnectionString(dbAccount.connectionString);
            } else if (dbAccount instanceof DocDBAccountTreeItemBase) {
                actual = parseDocDBConnectionString(dbAccount.connectionString);
            } else if (dbAccount instanceof PostgresServerTreeItem) {
                actual = dbAccount.connectionString;
            } else {
                return undefined;
            }

            if (expected.accountId === actual.accountId) {
                if (expected.databaseName) {
                    const dbs = await dbAccount.getCachedChildren(context);
                    for (const db of dbs) {
                        if ((db instanceof MongoDatabaseTreeItem || db instanceof DocDBDatabaseTreeItemBase || db instanceof PostgresDatabaseTreeItem) && expected.databaseName === db.databaseName) {
                            return new DatabaseTreeItemInternal(expected, expected.databaseName, dbAccount, db);
                        }
                    }

                    // We found the right account - just not the db. In this case we can still 'reveal' the account
                    return new DatabaseTreeItemInternal(expected, expected.databaseName, dbAccount);
                }

                return new DatabaseAccountTreeItemInternal(expected, dbAccount);
            }
        }
    } catch (error) {
        // Swallow all errors to avoid blocking the db account search
        // https://github.com/microsoft/vscode-cosmosdb/issues/966
    }

    return undefined;
}
