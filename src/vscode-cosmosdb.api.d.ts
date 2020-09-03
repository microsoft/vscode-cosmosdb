/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AzureDatabasesExtensionApi {
    apiVersion: string;

    /**
     * Finds the first matching item in the Azure Databases tree, or otherwise returns undefined.
     * NOTE: The item may not actually be loaded/attached in the tree until 'reveal' is called.
     *
     * @param query The query object to use for the find
     */
    findTreeItem(query: TreeItemQuery): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined>;

    /**
     * Prompts the user to pick an item from the Azure Databases tree
     *
     * @param options Configures the behavior of the tree item picker
     */
    pickTreeItem(options: PickTreeItemOptions & { resourceType: 'DatabaseAccount' }): Promise<DatabaseAccountTreeItem | undefined>;
    pickTreeItem(options: PickTreeItemOptions & { resourceType: 'Database' }): Promise<DatabaseTreeItem | undefined>;

    /**
     * Simpler version of `AzureDatabasesTreeItem.reveal` based on the `resourceId` instead of querying based on a connection string
     */
    revealTreeItem(resourceId: string): Promise<void>;
}

export interface AzureDatabasesTreeItem {
    /**
     * Reveals the item in the tree. This may result in loading more Azure Databases tree items or manually attaching by connection string.
     */
    reveal(): Promise<void>;
}

export interface DatabaseAccountTreeItem extends AzureDatabasesTreeItem {
    hostName: string;
    port: string;
    connectionString: string;

    /**
     * Data specific to Azure or undefined if the resource is not in Azure.
     */
    azureData?: {
        accountName: string;
        accountId?: string;
    }

    docDBData?: {
        masterKey: string;
        documentEndpoint: string;
    }

    postgresData?: {
        username: string | undefined;
        password: string | undefined;
    }

}

export interface DatabaseTreeItem extends DatabaseAccountTreeItem {
    databaseName: string;
}

export type AzureDatabasesResourceType = 'DatabaseAccount' | 'Database';

export type AzureDatabasesApiType = 'Mongo' | 'SQL' | 'Graph' | 'Table' | 'Postgres';

export interface PickTreeItemOptions {
    /**
     * The resource type of the picked item
     */
    resourceType: AzureDatabasesResourceType;

    /**
     * An array of the API types that can be picked, or undefined if all API types are allowed
     */
    apiType?: AzureDatabasesApiType[];
}

export interface TreeItemQuery {
    /**
     * An account or database connection string
     */
    connectionString: string;
}
