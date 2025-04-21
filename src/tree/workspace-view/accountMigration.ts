/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, nonNullValue } from '@microsoft/vscode-azext-utils';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../services/storageService';
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
    const items = await StorageService.get(StorageNames.Workspace).getItems(WorkspaceResourceType.AttachedAccounts);
    const documentDbAccounts = items.filter((item) => {
        const api: API = nonNullValue(item.properties?.api, API.Common) as API;
        return api === API.MongoDB || api === API.MongoClusters;
    });

    for (const item of documentDbAccounts) {
        if (!item.properties) {
            item.properties = {};
        }
        item.properties.api = API.MongoClusters; // Update the API to MongoClusters

        await StorageService.get(StorageNames.Workspace).push(WorkspaceResourceType.MongoClusters, item, true);
        await StorageService.get(StorageNames.Workspace).delete(WorkspaceResourceType.AttachedAccounts, item.id);
    }
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
