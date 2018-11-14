/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParsedMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { DatabaseTreeItem } from '../../vscode-cosmosdb.api';

/**
 * This cache is used to speed up api calls from other extensions to the Cosmos DB extension
 * For now, it only helps on a per-session basis
 */
const sessionCache: Map<string, DatabaseTreeItem> = new Map();

export function cacheTreeItem(parsedCS: ParsedMongoConnectionString, treeItem: DatabaseTreeItem): void {
    sessionCache.set(parsedCS.fullId, treeItem);
}

export function tryGetTreeItemFromCache(parsedCS: ParsedMongoConnectionString): DatabaseTreeItem | undefined {
    if (sessionCache.has(parsedCS.fullId)) {
        return sessionCache.get(parsedCS.fullId);
    } else {
        return undefined;
    }
}

export function removeTreeItemFromCache(expected: ParsedMongoConnectionString): void {
    if (!expected.databaseName) {
        // If parsedCS represents an account, remove the account and any databases that match that account
        for (const [key, value] of sessionCache.entries()) {
            const actual = new ParsedMongoConnectionString(value.connectionString, value.hostName, value.port, value.databaseName);
            if (actual.accountId === expected.accountId) {
                sessionCache.delete(key);
            }
        }
    } else if (sessionCache.has(expected.fullId)) {
        sessionCache.delete(expected.fullId);
    }
}
