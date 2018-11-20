/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { DocDBAccountTreeItem } from '../../docdb/tree/DocDBAccountTreeItem';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBDatabaseTreeItem } from '../../docdb/tree/DocDBDatabaseTreeItem';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { GraphAccountTreeItem } from '../../graph/tree/GraphAccountTreeItem';
import { GraphDatabaseTreeItem } from '../../graph/tree/GraphDatabaseTreeItem';
import { parseMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { TableAccountTreeItem } from '../../table/tree/TableAccountTreeItem';
import { AttachedAccountSuffix } from '../../tree/AttachedAccountsTreeItem';
import { CosmosDBApiType, DatabaseAccountTreeItem, DatabaseTreeItem, PickTreeItemOptions } from '../../vscode-cosmosdb.api';
import { cacheTreeItem } from './apiCache';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';
import { DatabaseTreeItemInternal } from './DatabaseTreeItemInternal';

const databaseContextValues = [MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue, GraphDatabaseTreeItem.contextValue];
const accountContextValues = [GraphAccountTreeItem.contextValue, DocDBAccountTreeItem.contextValue, TableAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue];

function getDatabaseContextValue(apiType: CosmosDBApiType) {
    switch (apiType) {
        case 'Mongo':
            return MongoDatabaseTreeItem.contextValue;
        case 'SQL':
            return DocDBDatabaseTreeItem.contextValue;
        case 'Graph':
            return GraphDatabaseTreeItem.contextValue;
        default:
            throw new RangeError(`Unsupported api type "${apiType}".`);
    }
}

function getAccountContextValue(apiType: CosmosDBApiType) {
    switch (apiType) {
        case 'Mongo':
            return MongoAccountTreeItem.contextValue;
        case 'SQL':
            return DocDBAccountTreeItem.contextValue;
        case 'Graph':
            return GraphAccountTreeItem.contextValue;
        case 'Table':
            return TableAccountTreeItem.contextValue;
        default:
            throw new RangeError(`Unsupported api type "${apiType}".`);
    }
}

export async function pickTreeItem(options: PickTreeItemOptions): Promise<DatabaseTreeItem | DatabaseAccountTreeItem | undefined> {
    let contextValuesToFind;
    switch (options.resourceType) {
        case 'Database':
            contextValuesToFind = options.apiType ? options.apiType.map(getDatabaseContextValue) : databaseContextValues;
            break;
        case 'DatabaseAccount':
            contextValuesToFind = options.apiType ? options.apiType.map(getAccountContextValue) : accountContextValues;
            contextValuesToFind = contextValuesToFind.concat(contextValuesToFind.map((val: string) => val += AttachedAccountSuffix));
            break;
        default:
            throw new RangeError(`Unsupported resource type "${options.resourceType}".`);
    }

    const pickedItem = await ext.tree.showTreeItemPicker(contextValuesToFind);

    let parsedCS: ParsedConnectionString;
    let accountNode: MongoAccountTreeItem | DocDBAccountTreeItemBase;
    let databaseNode: MongoDatabaseTreeItem | DocDBDatabaseTreeItemBase | undefined;
    if (pickedItem instanceof MongoAccountTreeItem) {
        parsedCS = await parseMongoConnectionString(pickedItem.connectionString);
        accountNode = pickedItem;
    } else if (pickedItem instanceof DocDBAccountTreeItemBase) {
        parsedCS = parseDocDBConnectionString(pickedItem.connectionString);
        accountNode = pickedItem;
    } else if (pickedItem instanceof MongoDatabaseTreeItem) {
        parsedCS = await parseMongoConnectionString(pickedItem.connectionString);
        accountNode = pickedItem.parent;
        databaseNode = pickedItem;
    } else if (pickedItem instanceof DocDBDatabaseTreeItemBase) {
        parsedCS = parseDocDBConnectionString(pickedItem.connectionString);
        accountNode = pickedItem.parent;
        databaseNode = pickedItem;
    }

    const result = databaseNode ?
        new DatabaseTreeItemInternal(parsedCS, accountNode, databaseNode) :
        new DatabaseAccountTreeItemInternal(parsedCS, accountNode);
    cacheTreeItem(parsedCS, result);
    return result;
}
