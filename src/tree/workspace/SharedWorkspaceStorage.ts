/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WorkspaceResourceType } from '@microsoft/vscode-azureresources-api';
import { ext } from '../../extensionVariables';
export type SharedWorkspaceStorageItem = {
    id: string;
    name: string;
    properties?: Record<string, string>;

    secrets?: string[];
};

export class SharedWorkspaceStorage {
    private readonly storageName: string = 'ms-azuretools.vscode-cosmosdb.workspace';

    /**
     * Retrieves all items from the storage along with their secrets.
     * The item's `id` is used as the key and must be unique per `workspaceType`.
     *
     * @param workspaceType - The type of the workspace resource.
     * @returns An array of items.
     */
    async getItems(workspaceType: WorkspaceResourceType): Promise<SharedWorkspaceStorageItem[]> {
        const storageKeyPrefix = `${this.storageName}/${workspaceType}/`;
        const keys = ext.context.globalState.keys().filter((key) => key.startsWith(storageKeyPrefix));
        const items: SharedWorkspaceStorageItem[] = [];

        for (const key of keys) {
            const item = ext.context.globalState.get<SharedWorkspaceStorageItem>(key);
            if (item) {
                // Read secrets associated with the item
                const secrets: string[] = [];
                const secretsLengthStr = await ext.secretStorage.get(`${key}.length`);
                const secretsLength = secretsLengthStr ? parseInt(secretsLengthStr, 10) : 0;

                for (let i = 0; i < secretsLength; i++) {
                    const secret = await ext.secretStorage.get(`${key}/${i}`);
                    if (secret !== undefined) {
                        secrets.push(secret);
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
    async push(
        workspaceType: WorkspaceResourceType,
        item: SharedWorkspaceStorageItem,
        overwrite: boolean = true,
    ): Promise<void> {
        const storageKey = `${this.storageName}/${workspaceType}/${item.id}`;

        // Check for existing item
        const existingItem = ext.context.globalState.get<SharedWorkspaceStorageItem>(storageKey);
        if (existingItem && !overwrite) {
            throw new Error(`An item with id '${item.id}' already exists for workspaceType '${workspaceType}'.`);
        }

        // Save all secrets
        if (item.secrets && item.secrets.length > 0) {
            // Store the number of secrets
            await ext.secretStorage.store(`${storageKey}.length`, item.secrets.length.toString());

            // Store each secret individually
            await Promise.all(
                item.secrets.map(async (secret, index) => {
                    await ext.secretStorage.store(`${storageKey}/${index}`, secret);
                }),
            );
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
    async delete(workspaceType: WorkspaceResourceType, itemId: string): Promise<void> {
        const storageKey = `${this.storageName}/${workspaceType}/${itemId}`;

        // Delete the item from globalState
        await ext.context.globalState.update(storageKey, undefined);

        // Retrieve the number of secrets to delete
        const secretsLengthStr = await ext.secretStorage.get(`${storageKey}.length`);
        const secretsLength = secretsLengthStr ? parseInt(secretsLengthStr, 10) : 0;

        // Delete each secret
        for (let i = 0; i < secretsLength; i++) {
            await ext.secretStorage.delete(`${storageKey}/${i}`);
        }

        // Delete the secret length indicator
        await ext.secretStorage.delete(`${storageKey}.length`);
    }

    /**
     * Retrieves all item `id`s stored for a given `workspaceType`.
     * The item's `id` is used as the key and must be unique per `workspaceType`.
     *
     * @param workspaceType - The type of the workspace resource.
     * @returns An array of item `id`s.
     */
    keys(workspaceType: WorkspaceResourceType): string[] {
        const storageKeyPrefix = `${this.storageName}/${workspaceType}/`;
        const keys = ext.context.globalState
            .keys()
            .filter((key) => key.startsWith(storageKeyPrefix))
            .map((key) => key.substring(storageKeyPrefix.length));

        return keys;
    }
}
