/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Temporary API for migrating MongoDB cluster connections to authorized extensions.
 * This is needed to support user data migration from the vscode-cosmosdb extension
 * to the vscode-documentdb extension.
 * The code is inline to keep it easy to maintain and to remove post-migration-phase.
 */
export interface MongoConnectionMigrationApi {
    apiVersion: string;

    /**
     * Exports MongoDB cluster connections for authorized extensions
     * @param callingExtensionContext - The extension context of the calling extension
     * @returns Promise resolving to connection data if authorized, undefined otherwise
     */
    exportMongoClusterConnections(
        callingExtensionContext: import('vscode').ExtensionContext,
    ): Promise<unknown[] | undefined>;

    /**
     * Renames the storage ID of a MongoDB cluster connection
     * @param callingExtensionContext - The extension context of the calling extension
     * @param oldId - The current storage ID of the connection
     * @param newId - The new storage ID to assign to the connection
     * @returns Promise<boolean> - True if successful, false if failed or not authorized
     */
    renameMongoClusterConnectionStorageId(
        callingExtensionContext: import('vscode').ExtensionContext,
        oldId: string,
        newId: string,
    ): Promise<boolean>;
}

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
    pickTreeItem(
        options: PickTreeItemOptions & { resourceType: 'DatabaseAccount' },
    ): Promise<DatabaseAccountTreeItem | undefined>;
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
        accountId: string;
    };

    docDBData?: {
        masterKey: string;
        documentEndpoint: string;
    };

    postgresData?: {
        username: string | undefined;
        password: string | undefined;
    };
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
    connectionString?: string;

    postgresData?: {
        hostName: string;
        port: string;
        databaseName: string | undefined;
        username: string | undefined;
        password: string | undefined;
    };
}
