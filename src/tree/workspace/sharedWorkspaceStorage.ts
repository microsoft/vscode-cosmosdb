/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WorkspaceResourceType } from '@microsoft/vscode-azureresources-api';
import { ext } from '../../extensionVariables';

/**
 * Represents an item stored in the shared workspace storage.
 * Each item has a unique `id`, a `name`, optional `properties`, and optional `secrets`.
 * The `id` of the item is used as the key in storage and must be unique per `workspaceType`.
 */
export type SharedWorkspaceStorageItem = {
    /**
     * Unique identifier for the item.
     */
    id: string;

    /**
     * Name of the item.
     */
    name: string;

    /**
     * Optional properties associated with the item.
     */
    properties?: Record<string, string>;

    /**
     * Optional array of secrets associated with the item.
     * Secrets are stored securely using VSCode's SecretStorage API.
     */
    secrets?: string[];
};

/**
 * Manages the storage of items and their associated secrets in a shared workspace.
 * Items are stored in VSCode's globalState, and secrets are stored using SecretStorage.
 * Each item is uniquely identified by its `id` within a given `workspaceType`.
 *
 * The `id` of the item is used as the key in storage and must be unique per `workspaceType`.
 */
export class SharedWorkspaceStorage {
    private static readonly storageName: string = 'ms-azuretools.vscode-cosmosdb.workspace';

    /**
     * Retrieves all items from the storage along with their secrets.
     * The item's `id` is used as the key and must be unique per `workspaceType`.
     *
     * @param workspaceType - The type of the workspace resource.
     * @returns An array of items.
     */
    public static async getItems(workspaceType: WorkspaceResourceType): Promise<SharedWorkspaceStorageItem[]> {
        const storageKeyPrefix = `${SharedWorkspaceStorage.storageName}/${workspaceType}/`;
        const keys = ext.context.globalState.keys().filter((key) => key.startsWith(storageKeyPrefix));
        const items: SharedWorkspaceStorageItem[] = [];

        for (const key of keys) {
            const item = ext.context.globalState.get<SharedWorkspaceStorageItem>(key);
            if (item) {
                // Read secrets associated with the item
                const secretKey = `${key}/secrets`;
                const secretsJson = await ext.secretStorage.get(secretKey);

                let secrets: string[] = [];
                if (secretsJson) {
                    try {
                        secrets = JSON.parse(secretsJson) as string[];
                    } catch (error) {
                        console.error(`Failed to parse secrets for key ${key}:`, error);
                        secrets = [];
                    }
                }

                item.secrets = secrets;
                items.push(item);
            }
        }

        return items;
    }

    /**
     * Stores an item and its secrets into the global state and secret storage.
     * The item's `id` is used as the key and must be unique per `workspaceType`.
     *
     * @param workspaceType - The type of the workspace resource.
     * @param item - The item to store.
     * @param overwrite - If `false` and an item with the same `id` exists, an error is thrown.
     *                    Defaults to `true`.
     * @throws Error if `overwrite` is `false` and an item with the same `id` exists.
     */
    public static async push(
        workspaceType: WorkspaceResourceType,
        item: SharedWorkspaceStorageItem,
        overwrite: boolean = true,
    ): Promise<void> {
        const storageKey = `${SharedWorkspaceStorage.storageName}/${workspaceType}/${item.id}`;

        // Check for existing item
        const existingItem = ext.context.globalState.get<SharedWorkspaceStorageItem>(storageKey);
        if (existingItem && !overwrite) {
            throw new Error(`An item with id '${item.id}' already exists for workspaceType '${workspaceType}'.`);
        }

        // Save all secrets
        if (item.secrets && item.secrets.length > 0) {
            const secretKey = `${storageKey}/secrets`;
            const secretsJson = JSON.stringify(item.secrets);
            try {
                await ext.secretStorage.store(secretKey, secretsJson);
            } catch (error) {
                console.error(`Failed to store secrets for key ${secretKey}:`, error);
                throw error;
            }
        }

        // Remove secrets from the item before storing in globalState
        const itemToStore = { ...item };
        delete itemToStore.secrets;

        // Save the item in globalState
        await ext.context.globalState.update(storageKey, itemToStore);
    }

    /**
     * Deletes an item and its associated secrets from the storage.
     * The item's `id` is used as the key and must be unique per `workspaceType`.
     *
     * @param workspaceType - The type of the workspace resource.
     * @param itemId - The `id` of the item to delete.
     */
    public static async delete(workspaceType: WorkspaceResourceType, itemId: string): Promise<void> {
        const storageKey = `${SharedWorkspaceStorage.storageName}/${workspaceType}/${itemId}`;

        // Delete the item from globalState
        await ext.context.globalState.update(storageKey, undefined);

        // Delete its secrets
        await ext.secretStorage.delete(`${storageKey}/secrets`);
    }

    /**
     * Retrieves all item `id`s stored for a given `workspaceType`.
     * The item's `id` is used as the key and must be unique per `workspaceType`.
     *
     * @param workspaceType - The type of the workspace resource.
     * @returns An array of item `id`s.
     */
    keys(workspaceType: WorkspaceResourceType): string[] {
        const storageKeyPrefix = `${SharedWorkspaceStorage.storageName}/${workspaceType}/`;
        const keys = ext.context.globalState
            .keys()
            .filter((key) => key.startsWith(storageKeyPrefix))
            .map((key) => key.substring(storageKeyPrefix.length));

        return keys;
    }
}
