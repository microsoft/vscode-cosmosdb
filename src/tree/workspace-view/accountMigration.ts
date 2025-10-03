/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext, nonNullValue } from '@microsoft/vscode-azext-utils';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../services/storageService';
import { generateMongoStorageId } from '../../utils/storageUtils';
import { type PersistedAccount } from '../v1-legacy-api/AttachedAccountsTreeItem';
import { WorkspaceResourceType } from '../workspace-api/SharedWorkspaceResourceProvider';

/**
 * Move accounts from the old storage format to the new one
 */
export async function pickSupportedAccounts(): Promise<void> {
    return callWithTelemetryAndErrorHandling('accountMigration.pickSupportedAccounts', async () => {
        const serviceName = 'ms-azuretools.vscode-cosmosdb.connectionStrings';
        const value: string | undefined = ext.context.globalState.get(serviceName);

        if (!value) {
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const accounts: (string | PersistedAccount)[] = JSON.parse(value);
        for (const account of accounts) {
            let id: string;
            let name: string;
            let isEmulator: boolean;
            let api: API;

            if (typeof account === 'string') {
                // Default to Mongo if the value is a string for the sake of backwards compatibility
                // (Mongo was originally the only account type that could be attached)
                id = account;
                name = account;
                api = API.MongoDB;
                isEmulator = false;
            } else {
                id = (<PersistedAccount>account).id;
                name = (<PersistedAccount>account).id;
                api = (<PersistedAccount>account).defaultExperience;
                isEmulator = (<PersistedAccount>account).isEmulator ?? false;
            }

            // TODO: Ignore Postgres accounts until we have a way to handle them
            if (api === API.PostgresSingle || api === API.PostgresFlexible) {
                continue;
            }

            const connectionString: string = nonNullValue(
                await ext.secretStorage.get(`${serviceName}.${id}`),
                'connectionString',
            );

            const storageItem: StorageItem = {
                id,
                name,
                properties: { isEmulator, api },
                secrets: [connectionString],
            };

            await StorageService.get(StorageNames.Workspace).push(
                WorkspaceResourceType.AttachedAccounts,
                storageItem,
                true,
            );
        }
    });
}

/**
 * This function corrects a migration issue with the old storage format.
 *
 * All attached accounts were initially migrated to WorkspaceResourceType.AttachedAccounts.
 * However, MongoDB and MongoClusters accounts should be stored as WorkspaceResourceType.MongoClusters.
 *
 * This function moves those accounts to the correct storage location and updates their API property.
 */
export async function postPickSupportedAccountsCleanUp(): Promise<void> {
    return callWithTelemetryAndErrorHandling(
        'accountMigration.postPickSupportedAccountsCleanUp',
        async (context: IActionContext) => {
            let migratedAccounts = 0;
            let totalAccounts = 0;
            let noSecretsAccounts = 0;

            try {
                const oldItems = await StorageService.get(StorageNames.Workspace).getItems(
                    WorkspaceResourceType.AttachedAccounts,
                );
                const oldDocumentDbAccounts = oldItems.filter((item) => {
                    const api: API = nonNullValue(item.properties?.api, API.Common) as API;
                    return api === API.MongoDB || api === API.MongoClusters;
                });

                for (const currentItem of oldDocumentDbAccounts) {
                    totalAccounts++;
                    try {
                        if (!currentItem.properties) {
                            currentItem.properties = {};
                        }
                        currentItem.properties.api = API.MongoClusters; // Update the API to MongoClusters

                        if (!currentItem.secrets || currentItem.secrets.length === 0) {
                            // this is an item that is invalid as it doesn't have a connection string
                            // let's just drop it, no comment needed
                            noSecretsAccounts++;
                            continue;
                        }

                        const oldStorageId = currentItem.id;
                        // generate a new ID for the item that's inline with the new storage format
                        const newStorageId = generateMongoStorageId(currentItem.secrets[0]);
                        currentItem.id = newStorageId; // Update the ID to the new format

                        // First, try to push the item to the new location
                        await StorageService.get(StorageNames.Workspace).push(
                            WorkspaceResourceType.MongoClusters,
                            currentItem,
                            true,
                        );

                        // Verify that the item has been stored in the new location before deleting
                        const migratedItems = await StorageService.get(StorageNames.Workspace).getItems(
                            WorkspaceResourceType.MongoClusters,
                        );
                        const isMigrated = migratedItems.some((migratedItem) => migratedItem.id === newStorageId);

                        if (isMigrated) {
                            try {
                                // Then delete from the old location
                                await StorageService.get(StorageNames.Workspace).delete(
                                    WorkspaceResourceType.AttachedAccounts,
                                    oldStorageId,
                                );

                                migratedAccounts++;
                            } catch (deleteError) {
                                // If deletion fails, log it but don't throw - the item will be deleted on next run
                                // In worst case, we'll have duplicates until next clean-up run
                                console.log(
                                    `Failed to delete item ${oldStorageId} from AttachedAccounts, will retry on next run: ${deleteError}`,
                                );
                            }
                        } else {
                            // Item wasn't successfully migrated, log the issue
                            console.warn(
                                `Failed to verify migration of item ${oldStorageId} to MongoClusters, skipping deletion`,
                            );
                        }
                    } catch (itemError) {
                        // If processing a single item fails, log it and continue with other items
                        console.error(`Error processing item ${currentItem.id}: ${itemError}`);
                        // Continue with other items rather than failing the entire migration
                    }
                }
            } catch (error) {
                // Log the error but don't throw - this is a cleanup function
                // The next run of the function will attempt the cleanup again
                console.error(`Error in postPickSupportedAccountsCleanUp: ${error}`);
            } finally {
                context.telemetry.measurements.migratedAccounts = migratedAccounts;
                context.telemetry.measurements.totalAccounts = totalAccounts;
                context.telemetry.measurements.skippedDueToMissingSecrets = noSecretsAccounts;
            }
        },
    );
}

export async function migrateV1AccountsToV2(): Promise<void> {
    const serviceName = 'ms-azuretools.vscode-cosmosdb.connectionStrings';
    const value: string | undefined = ext.context.globalState.get(serviceName);

    if (!value) {
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const accounts: (string | PersistedAccount)[] = JSON.parse(value);
    const result = await Promise.allSettled(
        accounts.map(async (account) => {
            return callWithTelemetryAndErrorHandling(
                'CosmosDBAttachedAccountsResourceItem.migrateV1AccountsToV2',
                async (context) => {
                    context.errorHandling.rethrow = true;
                    context.errorHandling.forceIncludeInReportIssueCommand = true;

                    let id: string;
                    let name: string;
                    let isEmulator: boolean;
                    let api: API;

                    if (typeof account === 'string') {
                        // Default to Mongo if the value is a string for the sake of backwards compatibility
                        // (Mongo was originally the only account type that could be attached)
                        id = account;
                        name = account;
                        api = API.MongoDB;
                        isEmulator = false;
                    } else {
                        id = (<PersistedAccount>account).id;
                        name = (<PersistedAccount>account).id;
                        api = (<PersistedAccount>account).defaultExperience;
                        isEmulator = (<PersistedAccount>account).isEmulator ?? false;
                    }

                    const connectionString: string = nonNullValue(
                        await ext.secretStorage.get(`${serviceName}.${id}`),
                        'connectionString',
                    );

                    const storageItem: StorageItem = {
                        id,
                        name,
                        properties: {
                            isEmulator,
                            api,
                        },
                        secrets: [connectionString],
                    };

                    await StorageService.get(StorageNames.Workspace).push(
                        WorkspaceResourceType.AttachedAccounts,
                        storageItem,
                    );
                    await ext.secretStorage.delete(`${serviceName}.${id}`);

                    return storageItem;
                },
            );
        }),
    );

    const notMovedAccounts = result
        .map((r, index) => {
            if (r.status === 'rejected') {
                // Couldn't migrate the account, won't remove it from the old list
                return accounts[index];
            }

            const storageItem = r.value;

            if (storageItem?.properties?.api === API.MongoDB) {
                // TODO: Tomasz will handle this
                return accounts[index];
            }

            if (
                storageItem?.properties?.api === API.PostgresSingle ||
                storageItem?.properties?.api === API.PostgresFlexible
            ) {
                // TODO: Need to handle Postgres
                return accounts[index];
            }

            return undefined;
        })
        .filter((r) => r !== undefined);

    if (notMovedAccounts.length > 0) {
        await ext.context.globalState.update(serviceName, JSON.stringify(notMovedAccounts));
    } else {
        await ext.context.globalState.update(serviceName, undefined);
    }
}
