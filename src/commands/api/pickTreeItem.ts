/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { DocDBDatabaseTreeItem } from '../../docdb/tree/DocDBDatabaseTreeItem';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { GraphDatabaseTreeItem } from '../../graph/tree/GraphDatabaseTreeItem';
import { parseMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBApiType, DatabaseTreeItem, PickTreeItemOptions } from '../../vscode-cosmosdb.api';
import { cacheTreeItem } from './apiCache';
import { DatabaseTreeItemInternal } from './DatabaseTreeItemInternal';

const allSupportedDatabaseContextValues = [MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue, GraphDatabaseTreeItem.contextValue];

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

export async function pickTreeItem(options: PickTreeItemOptions): Promise<DatabaseTreeItem | undefined> {
    if (options.resourceType !== 'Database') {
        throw new Error('Pick method supports only database now.');
    }

    let contextValuesToFind = options.apiType ? options.apiType.map(getDatabaseContextValue) : allSupportedDatabaseContextValues;

    const pickedDatabase = <MongoDatabaseTreeItem | DocDBDatabaseTreeItemBase>(await ext.tree.showTreeItemPicker(contextValuesToFind));
    const parsedCS = pickedDatabase instanceof MongoDatabaseTreeItem ?
        await parseMongoConnectionString(pickedDatabase.connectionString) :
        await parseDocDBConnectionString(pickedDatabase.connectionString);

    const result = new DatabaseTreeItemInternal(parsedCS, pickedDatabase.parent, pickedDatabase);
    cacheTreeItem(parsedCS, result);
    return result;
}
