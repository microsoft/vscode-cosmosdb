/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';
import { getHostPortFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { CosmosDBApiType, DatabaseTreeItem, PickTreeItemOptions } from '../../vscode-cosmosdb.api';

const allSupportedDatabaseContextValues = [MongoDatabaseTreeItem.contextValue];

function getContextValue(str: CosmosDBApiType) {
    if (str === 'Mongo') {
        return MongoDatabaseTreeItem.contextValue;
    }

    throw new Error(`Pick method supports only Mongo database now.`);
}

export async function pickTreeItem(options: PickTreeItemOptions): Promise<DatabaseTreeItem | undefined> {
    if (options.resourceType !== 'Database') {
        throw new Error('Pick method supports only Mongo database now.');
    }

    let contextValuesToFind = allSupportedDatabaseContextValues;
    if (options.apiType) {
        contextValuesToFind = [];
        options.apiType.forEach(element => {
            contextValuesToFind.push(getContextValue(element));
        });
    }

    const pickedDatabase = <MongoDatabaseTreeItem>(await ext.tree.showTreeItemPicker(contextValuesToFind));
    const hostport = await getHostPortFromConnectionString(pickedDatabase.connectionString);
    return {
        databaseName: pickedDatabase.databaseName,
        connectionString: pickedDatabase.connectionString,
        hostName: hostport.host,
        port: hostport.port,
        azureData: pickedDatabase.parent.databaseAccount ? { accountName: pickedDatabase.parent.databaseAccount.name } : undefined,
        reveal: async () => await ext.treeView.reveal(pickedDatabase)
    };
}
