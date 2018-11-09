/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface CosmosDBExtensionApi {
    /**
     * Finds the first matching item in the Cosmos DB tree, or otherwise returns undefined.
     * NOTE: The item may not actually be loaded/attached in the tree until 'reveal' is called.
     *
     * @param query The query object to use for the find
     * @param options Configures the behavior of the find
     */
    findTreeItem(query: TreeItemQuery): Promise<DatabaseTreeItem | undefined>;

    /**
     * Prompts the user to pick an item from the Cosmos DB tree
     *
     * @param options Configures the behavior of the tree item picker
     */
    pickTreeItem(options: PickTreeItemOptions & { resourceType: 'DatabaseAccount' }): Promise<AccountTreeItem | undefined>;
    pickTreeItem(options: PickTreeItemOptions & { resourceType: 'Database' }): Promise<DatabaseTreeItem | undefined>;
}

export interface CosmosDBTreeItem {
    /**
     * Reveals the item in the tree. This may result in loading more Cosmos DB tree items or manually attaching by connection string.
     */
    reveal(): Promise<void>;
}

export interface AccountTreeItem extends CosmosDBTreeItem {
    hostName: string;
    port: string;
    connectionString: string;

    /**
     * Data specific to Azure or undefined if the resource is not in Azure.
     */
    azureData?: {
        accountName: string;
    }
}

export interface DatabaseTreeItem extends AccountTreeItem {
    databaseName: string;
}

export type CosmosDBResourceType = 'DatabaseAccount' | 'Database';

export type CosmosDBApiType = 'Mongo' | 'SQL' | 'Graph' | 'Table';

export interface PickTreeItemOptions {
    /**
     * The resource type of the picked item
     */
    resourceType: CosmosDBResourceType;

    /**
     * An array of the API types that can be picked, or undefined if all API types are allowed
     */
    apiType?: CosmosDBApiType[];
}

export interface TreeItemQuery {
    /**
     * An account or database connection string
     */
    connectionString: string;
}
