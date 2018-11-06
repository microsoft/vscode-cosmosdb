/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocDBDatabaseTreeItem } from '../../docdb/tree/DocDBDatabaseTreeItem';
import { ext } from '../../extensionVariables';
import { GraphDatabaseTreeItem } from '../../graph/tree/GraphDatabaseTreeItem';
import { getHostPortFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBResourceType, CosmosDBTreeItem, PickTreeItemOptions } from '../../vscode-cosmosdb.api';
import { reveal } from './reveal';

const databaseContextValues = [MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue, GraphDatabaseTreeItem.contextValue];

export async function pickTreeItem<T extends CosmosDBTreeItem>(options: PickTreeItemOptions): Promise<T | undefined> {
    if (options.resourceType === CosmosDBResourceType.DatabaseAccount) {
        throw new Error('Picked database method supports only mongo databases now.');
    }

    let contextValuesToFind = databaseContextValues;
    if (options.apiType) {
        contextValuesToFind = [];
        options.apiType.forEach(element => {
            contextValuesToFind.push(databaseContextValues[element.valueOf() - 1]);
        });
    }

    if (contextValuesToFind.length !== 1 || contextValuesToFind[0] !== MongoDatabaseTreeItem.contextValue) {
        throw new Error('Picked database method supports only mongo databases now.');
    }

    const pickedDatabase = <MongoDatabaseTreeItem>(await ext.tree.showTreeItemPicker(contextValuesToFind));
    const hostport = await getHostPortFromConnectionString(pickedDatabase.connectionString);
    // @ts-ignore
    return {
        databaseName: pickedDatabase.databaseName,
        connectionString: pickedDatabase.connectionString,
        hostName: hostport.host,
        port: hostport.port,
        azureData: { accountName: pickedDatabase.parent.name },
        reveal: () => reveal(pickedDatabase.fullId)
    };
}
