/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, nonNullValue } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { API, getExperienceFromApi } from '../AzureDBExperiences';
import { wellKnownEmulatorPassword } from '../constants';
import { type ParsedCosmosDBConnectionString } from '../cosmosdb/cosmosDBConnectionStrings';
import { StorageNames, StorageService, type StorageItem } from '../services/storageService';
import { WorkspaceResourceType } from '../tree/workspace-api/SharedWorkspaceResourceProvider';
import { randomUtils } from './randomUtils';

/**
 * Migrates an emulator item from the raw format where the connection string was part of the id
 * to a hashed format where the connection string is guaranteed to be stored in secrets. The
 * id of the item will be a hex hash of the connection string generated with {@link getEmulatorItemUniqueId}.
 *
 * The migration is necessary to ensure that the connection string is not exposed in the id and
 * to guarantee that the id is unique and can be still used as a TreeView id.
 *
 * This function does the following:
 * 1. Checks if the item is already in the new format (ID starts with 'emulator-')
 * 2. For items needing migration:
 *    - Extracts API type from properties
 *    - Gets connection string from secrets or falls back to ID
 *    - Extracts port number from name if available
 *    - Generates new name and ID for the emulator item
 *    - Creates a new item with updated properties
 *    - Stores the new item in shared workspace storage for the appropriate API type
 *    - Deletes the old item after successful migration
 *
 * If any error occurs during migration, the original item is returned unchanged and the error is logged.
 *
 * @param item - The emulator item to migrate
 * @returns A Promise that resolves to the migrated item, or the original item if migration fails
 */
export async function migrateRawEmulatorItemToHashed(item: StorageItem): Promise<StorageItem> {
    try {
        // Check if the item is already in the new format
        if (item.id.startsWith('emulator-')) {
            // Already in new format, add to result as-is
            return item;
        }

        // Process emulator items that need migration
        return (await callWithTelemetryAndErrorHandling(
            'CosmosDBWorkspaceItem.migrateRawEmulatorItemsToHashed',
            async (context) => {
                context.telemetry.suppressIfSuccessful = true;
                context.errorHandling.rethrow = true;

                const api: API = nonNullValue(item.properties?.api, 'api') as API;

                // very old versions didn't have secrets, the connection string was stored in the id
                const connectionString: string = item.secrets?.[0] ?? item.id;
                context.telemetry.properties.api = api;

                // Extract port from name if possible
                const portMatch = item.name.match(/:[\s]*(\d+)$/);
                const port = portMatch ? Number(portMatch[1]) : undefined;

                const newName = getEmulatorItemLabelForApi(api, port);
                const newId = getEmulatorItemUniqueId(connectionString);
                const newItem: StorageItem = {
                    ...item,
                    id: newId,
                    name: newName,
                    secrets: [connectionString],
                };

                const workspaceType =
                    api === API.Core ? WorkspaceResourceType.AttachedAccounts : WorkspaceResourceType.MongoClusters;

                try {
                    // Store the new item, or abort if it already exists which would be unexpected at this point
                    await StorageService.get(StorageNames.Workspace).push(workspaceType, newItem, false);
                } catch (error) {
                    throw new Error(`Failed to migrate emulator item "${item.id}": ${error}`);
                }
                // Delete old item after successful migration
                await StorageService.get(StorageNames.Workspace).delete(workspaceType, item.id);

                return newItem;
            },
        )) as StorageItem;
    } catch {
        // the error has already been logged by callWithTelemetryAndErrorHandling
        // If migration fails, keep the original item
        return item;
    }
}

/**
 * Generates a unique ID for an emulator item based on the connection string.
 * The ID is prefixed with 'emulator-' and is derived from a hash of the connection string.
 *
 * @param connectionString - The connection string to hash
 * @returns A unique ID for the emulator item
 */
export function getEmulatorItemUniqueId(connectionString: string): string {
    const migratedMarker = 'emulator-';
    return `${migratedMarker}${randomUtils.getPseudononymousStringHash(connectionString, 'hex').substring(0, 24)}`;
}

/**
 * Generates a label for an emulator item based on the API type and port.
 * The label is localized and includes the experience name.
 *
 * @param api - The API type of the emulator
 * @param port - The port number (optional)
 * @returns A localized label for the emulator item
 */
export function getEmulatorItemLabelForApi(api: API, port: string | number | undefined): string {
    const experience = getExperienceFromApi(api);
    let label = l10n.t('{experienceName} Emulator', { experienceName: experience.shortName });

    if (experience.api === API.MongoDB || experience.api === API.MongoClusters) {
        label = l10n.t('MongoDB Emulator');
    }

    const portSuffix = typeof port !== 'undefined' ? ` : ${port}` : '';
    return `${label}${portSuffix}`;
}

/**
 * Checks if the given connection string is for an emulator.
 * An emulator connection string is identified by a well-known password or a localhost hostname.
 *
 * @param connectionString - The parsed connection string to check
 * @returns True if the connection string is for an emulator, false otherwise
 */
export function getIsEmulatorConnection(connectionString: ParsedCosmosDBConnectionString): boolean {
    return connectionString.masterKey === wellKnownEmulatorPassword || connectionString.hostName === 'localhost';
}
