/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CosmosDBDatabase {
    accountName: string
    connectionString: string
    treeItemId: string
    databaseName: string
}

export interface VSCodeCosmosDB {
    /**
     * Finds the database in CosmosDB and returns CosmosDBDatabase object or undefined if can't find
     * @param detectionData The database connection string
     */
    getDatabase(detectionData: { connectionString: string }): Promise<CosmosDBDatabase | undefined>;

    /**
     *  Traverses the CosmosDB tree with a quick pick at each level. Goes until find item with database-level context value. Returns the CosmosDBDatabase object based on picked db.
     */
    pickDatabase(): Promise<CosmosDBDatabase | undefined>;

    /**
     * Reveal tree item in the CosmosDB explorer by its id
     * @param treeItemId The id of the CosmosDB tree item
     */
    revealTreeItem(treeItemId: string): Promise<void>;
}
