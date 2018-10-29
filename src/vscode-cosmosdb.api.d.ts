/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CosmosDBItem {
    accountName: string
    connectionString: string
    treeItemId: string
    databaseName: string
}

export interface VSCodeCosmosDB {
    /**
     * Finds the database in CosmosDB and returns CosmosDBItem object or undefined if can't find
     * @param detectionData The database connection string
     */
    getDatabase(detectionData: { connectionString: string }): Promise<CosmosDBItem | undefined>;

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
