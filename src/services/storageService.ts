/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WorkspaceResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { ext } from '../extensionVariables';

/**
 * Represents an item stored in the storage.
 * Each item has a unique `id`, a `name`, optional `properties`, and optional `secrets`.
 * The `id` of the item is used as the key in storage and must be unique per storage location.
 */
export type StorageItem = {
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
    properties?: Record<string, string[] | string | boolean>;

    /**
     * Optional array of secrets associated with the item.
     * Secrets are stored securely using VSCode's SecretStorage API.
     */
    secrets?: string[];
};

/**
 * Storage is organized by workspace (acting as a "directory") and items are identified by their unique IDs.
 * Each item can have properties and optional secrets that are stored securely.
 */
export interface Storage {
    /**
     * Retrieves all items from the storage along with their secrets for a specific workspace.
     * Items are stored using their `id` as a key within the workspace.
     *
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @returns A promise resolving to an array of storage items with their secrets loaded.
     */
    getItems(workspace: WorkspaceResourceType): Promise<StorageItem[]>;

    /**
     * Stores an item and its secrets into storage for a specific workspace.
     * The item's `id` is used as the key and must be unique within the workspace.
     * Item properties are stored in globalState while secrets are stored securely
     * using VSCode's SecretStorage API.
     *
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @param item - The item to store, containing id, name, and optional properties and secrets.
     * @param overwrite - If `false` and an item with the same `id` exists, an error is thrown.
     *                    Defaults to `true`.
     * @returns A promise that resolves when the item has been stored.
     * @throws Error if `overwrite` is `false` and an item with the same `id` exists.
     */
    push(workspace: WorkspaceResourceType, item: StorageItem, overwrite?: boolean): Promise<void>;

    /**
     * Deletes an item and its associated secrets from storage for a specific workspace.
     * Both the item data and any associated secrets are removed.
     *
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @param itemId - The `id` of the item to delete.
     * @returns A promise that resolves when the item has been deleted.
     */
    delete(workspace: WorkspaceResourceType, itemId: string): Promise<void>;

    /**
     * Retrieves all item `id`s stored for a specific workspace.
     * This provides a list of all item identifiers without loading the full items.
     *
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @returns An array of item `id`s stored in the specified workspace.
     */
    keys(workspace: WorkspaceResourceType): string[];
}

/**
 * Private implementation of Storage interface that manages items and their
 * associated secrets in VSCode's storage mechanisms.
 *
 * Items are stored in VSCode's globalState, and secrets are stored using SecretStorage.
 * Each item is uniquely identified by its `id` within a given workspace.
 *
 * This class cannot be instantiated directly - use StorageService.get() instead.
 */
class StorageImpl implements Storage {
    private readonly storageName: string;

    constructor(storageName: string) {
        this.storageName = storageName;
    }

    /**
     * Implementation of Storage.getItems that retrieves all items along with their secrets.
     */
    public async getItems(workspace: string): Promise<StorageItem[]> {
        const storageKeyPrefix = `${this.storageName}/${workspace}/`;
        const keys = ext.context.globalState.keys().filter((key) => key.startsWith(storageKeyPrefix));
        const items: StorageItem[] = [];

        for (const key of keys) {
            const item = ext.context.globalState.get<StorageItem>(key);
            if (item) {
                // ensure that the real id is used, same as the one used in the storage
                item.id = key.substring(storageKeyPrefix.length);

                // Read secrets associated with the item
                const secretKey = `${key}/secrets`;
                const secretsJson = await ext.secretStorage.get(secretKey);

                let secrets: string[] = [];
                if (secretsJson) {
                    try {
                        secrets = JSON.parse(secretsJson) as string[];
                    } catch (error) {
                        console.error(l10n.t('Failed to parse secrets for key {0}:', key), error);
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
     * Implementation of Storage.push that stores an item and its secrets.
     */
    public async push(workspace: string, item: StorageItem, overwrite: boolean = true): Promise<void> {
        const storageKey = `${this.storageName}/${workspace}/${item.id}`;

        // Check for existing item
        const existingItem = ext.context.globalState.get<StorageItem>(storageKey);
        if (existingItem && !overwrite) {
            throw new Error(l10n.t('An item with id "{0}" already exists for workspace "{1}".', item.id, workspace));
        }

        // Save all secrets
        if (item.secrets && item.secrets.length > 0) {
            const secretKey = `${storageKey}/secrets`;
            const secretsJson = JSON.stringify(item.secrets);
            try {
                await ext.secretStorage.store(secretKey, secretsJson);
            } catch (error) {
                console.error(l10n.t('Failed to store secrets for key {0}:', secretKey), error);
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
     * Implementation of Storage.delete that removes an item and its associated secrets.
     * Attempts to maintain atomicity by ensuring both the item and its secrets are deleted.
     *
     * @param workspace - The workspace identifier acting as a directory for the items.
     * @param itemId - The `id` of the item to delete.
     * @throws Error if deletion of the item or its secrets fails.
     */
    public async delete(workspace: string, itemId: string): Promise<void> {
        const storageKey = `${this.storageName}/${workspace}/${itemId}`;
        const secretKey = `${storageKey}/secrets`;

        // First check if the item exists
        const existingItem = ext.context.globalState.get<StorageItem>(storageKey);
        if (!existingItem) {
            return; // Item doesn't exist, nothing to delete
        }

        try {
            // First delete the item from globalState
            await ext.context.globalState.update(storageKey, undefined);

            try {
                // Then delete its secrets
                await ext.secretStorage.delete(secretKey);
            } catch (secretError) {
                // Try to restore the item since secret deletion failed
                try {
                    await ext.context.globalState.update(storageKey, existingItem);
                } catch {
                    // If restoration fails, we're in an inconsistent state, but we can't do much now. Throw the original error.
                }
                throw new Error(l10n.t('Failed to delete secrets for item "{0}".', itemId), { cause: secretError });
            }
        } catch (itemError) {
            if (itemError instanceof Error) {
                throw itemError; // Rethrow errors
            }
            throw new Error(l10n.t('Failed to delete item "{0}".', itemId));
        }
    }

    /**
     * Implementation of Storage.keys that lists all item IDs in a workspace.
     */
    public keys(workspace: string): string[] {
        const storageKeyPrefix = `${this.storageName}/${workspace}/`;
        const keys = ext.context.globalState
            .keys()
            .filter((key) => key.startsWith(storageKeyPrefix))
            .map((key) => key.substring(storageKeyPrefix.length));

        return keys;
    }
}

/**
 * A helper enum for common storage names used in StorageService.get().
 *
 * This enum provides a set of predefined constants that you can use instead of literal strings.
 * Using these constants helps prevent typos and saves time when specifying storage names.
 * For example, you can call StorageService.get(StorageNames.Workspace) to retrieve the workspace-specific storage.
 */
export enum StorageNames {
    Connections = 'connections',
    Default = 'default',
    Global = 'global',
    Workspace = 'workspace',
}

/**
 * Service for accessing and managing storage instances with different storage names.
 * Maintains a singleton pattern for each unique storage name to prevent duplication.
 *
 * This is the only public entry point for obtaining Storage instances.
 */
export class StorageService {
    private static instances: Map<string, Storage> = new Map();

    /**
     * Gets or creates a storage instance for the specified storage name.
     * If no name is provided, defaults to the default storage for the extension.
     * The name will be derived from the extension ID and the provided storage name.
     *
     * Storage instances are cached for reuse to maintain consistency.
     *
     * @param storageName - The name of the storage location. Optional.
     * @returns A Storage instance configured for the given storage name.
     */
    public static get(storageName?: string): Storage {
        const name = [ext.context.extension.id, storageName ?? 'default'].join('.');

        if (!this.instances.has(name)) {
            this.instances.set(name, new StorageImpl(name));
        }

        return this.instances.get(name)!;
    }
}
