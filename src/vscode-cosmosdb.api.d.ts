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
     */
    findTreeItem<T extends CosmosDBTreeItem>(query: TreeItemQuery): Promise<T | undefined>;

    /**
     * Prompts the user to pick an item from the Cosmos DB tree
     *
     * @param options Configures the behavior of the tree item picker
     */
    pickTreeItem<T extends CosmosDBTreeItem>(options: PickTreeItemOptions): Promise<T | undefined>;
}

export interface CosmosDBTreeItem {
    /**
     * Reveals the item in the tree. This may result in loading more Cosmos DB tree items or manually attaching by connection string.
     */
    reveal(): Promise<void>;
}

export interface DatabaseTreeItem extends CosmosDBTreeItem {
    connectionString: string;
    databaseName: string;
    hostName: string;
    port: string;

    /**
     * Data specific to Azure or undefined if the resource is not in Azure.
     */
    azureData?: {
        accountName: string;
    };
}

/**
 * See here for more info on Cosmos DB resource types:
 * https://docs.microsoft.com/azure/cosmos-db/sql-api-resources
 */
export enum CosmosDBResourceType {
    /**
     * A database account is associated with a set of databases and a fixed amount of blob storage for attachments.
     */
    DatabaseAccount = 1,

    /**
     * A database is a logical container of document storage partitioned across collections.
     */
    Database = 2
}

export enum CosmosDBApiType {
    /**
     * https://docs.microsoft.com/azure/cosmos-db/mongodb-introduction
     */
    Mongo = 1,

    /**
     * https://docs.microsoft.com/azure/cosmos-db/sql-api-introduction
     */
    SQL = 2,

    /**
     * https://docs.microsoft.com/azure/cosmos-db/graph-introduction
     */
    Graph = 3,

    /**
     * https://docs.microsoft.com/azure/cosmos-db/table-introduction
     */
    Table = 4
}

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
