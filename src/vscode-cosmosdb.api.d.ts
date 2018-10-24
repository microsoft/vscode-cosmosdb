/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface VSCodeCosmosDB {
    /**
     * Returns connection string of the CosmosDB item by specified id. Throw an error if the item doesn't have a connection string.
     * @param treeItemId The id of the CosmosDB tree item
     */
    readonly getConnectionString: (treeItemId: string) => Promise<string>;

    /**
     * Traverses the CosmosDB tree with a quick pick at each level. Goes until find item with database-level context value. Returns the CosmosDB tree item id.
     */
    readonly getDatabase: () => Promise<string>;

    /**
     * Reveal tree item in the CosmosDB explorer by its id
     * @param treeItemId The id of the CosmosDB tree item
     */
    readonly revealTreeItem: (treeItemId: string) => Promise<void>;
}
