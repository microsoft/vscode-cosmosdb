/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CosmosDBDatabase {
    accountName: string
    connectionString: string
    databaseName: string
    treeItemId: string
}

export interface VSCodeCosmosDB {
    /**
     * Attach database as Attached Database Account and returns the CosmosDBDatabase object of it
     * @param connectionString The database connection string
     */
    attachDatabase(databaseInfo: { connectionString: string }): Promise<CosmosDBDatabase | undefined>;

    /**
     * Finds the database in CosmosDB and returns CosmosDBDatabase object or undefined if can't find
     * @param searchCriteria The database connection string
     */
    getDatabase(searchCriteria: { connectionString: string }): Promise<CosmosDBDatabase | undefined>;

    /**
     *  Traverses the CosmosDB tree with a quick pick at each level. Goes until find item with database-level context value. Returns the CosmosDBDatabase object based on picked db.
     *  Returns undefined(not UserCancelledError) because it's VS Code pattern and we follow it in the "official" API
     */
    pickDatabase(): Promise<CosmosDBDatabase | undefined>;

    /**
     * Reveal tree item in the CosmosDB explorer by its id, returns undefined if couldn't find the item
     * @param treeItemId The id of the CosmosDB tree item
     */
    revealTreeItem(treeItemId: string): Promise<boolean>;
}
