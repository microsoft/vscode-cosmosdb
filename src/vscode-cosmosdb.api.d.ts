/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CosmosDBItem {
    accountName: string | undefined
    connectionString: string | undefined
    cosmosDBTreeItemId: string | undefined
    databaseName: string | undefined
}

export interface VSCodeCosmosDB {
    /**
     * Founds the database in CosmosDB and return info about it including TreeItem id in CosmosDB Explorer
     * @param connectionData The connection string and/or other info that provided for successfull database searching
     */
    getDatabase(connectionData: CosmosDBItem): Promise<CosmosDBItem | undefined>;

    /**
     *  Traverses the CosmosDB tree with a quick pick at each level. Goes until find item with database-level context value. Returns the CosmosDBItem object based on picked db.
     */
    pickDatabase(): Promise<CosmosDBItem | undefined>;

    /**
     * Reveal tree item in the CosmosDB explorer by its id
     * @param treeItemId The id of the CosmosDB tree item
     */
    revealTreeItem(treeItemId: string): Promise<void>;
}
