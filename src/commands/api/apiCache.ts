/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParsedDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { ParsedMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { ParsedPostgresConnectionString, parsePostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { DatabaseAccountTreeItem, DatabaseTreeItem } from '../../vscode-cosmosdb.api';

/**
 * This cache is used to speed up api calls from other extensions to the Cosmos DB extension
 * For now, it only helps on a per-session basis
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const sessionCache: Map<string, DatabaseAccountTreeItem | DatabaseTreeItem> = new Map();

export function cacheTreeItem(parsedCS: ParsedConnectionString, treeItem: DatabaseAccountTreeItem | DatabaseTreeItem): void {
    sessionCache.set(parsedCS.fullId, treeItem);
}

export function tryGetTreeItemFromCache(parsedCS: ParsedConnectionString): DatabaseAccountTreeItem | DatabaseTreeItem | undefined {
    return sessionCache.get(parsedCS.fullId);
}

export function removeTreeItemFromCache(expected: ParsedConnectionString): void {
    if (!expected.databaseName) {
        // If parsedCS represents an account, remove the account and any databases that match that account
        for (const [key, value] of sessionCache.entries()) {
            let actual: ParsedConnectionString | undefined;
            if (expected instanceof ParsedPostgresConnectionString) {
                actual = parsePostgresConnectionString(value.connectionString);
            } else if (expected instanceof ParsedMongoConnectionString) {
                actual = new ParsedMongoConnectionString(value.connectionString, value.hostName, value.port, undefined);
            } else {
                actual = new ParsedDocDBConnectionString(value.connectionString, value.hostName, value.port, undefined);
            }
            if (actual && (actual.accountId === expected.accountId)) {
                sessionCache.delete(key);
            }
        }
    } else {
        sessionCache.delete(expected.fullId);
    }
}
