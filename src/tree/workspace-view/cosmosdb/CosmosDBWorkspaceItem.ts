/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, createContextValue, nonNullValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, getExperienceFromApi } from '../../../AzureDBExperiences';
import { isEmulatorSupported } from '../../../constants';
import { ext } from '../../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../../services/storageService';
import { GraphAccountAttachedResourceItem } from '../../graph/GraphAccountAttachedResourceItem';
import { NoSqlAccountAttachedResourceItem } from '../../nosql/NoSqlAccountAttachedResourceItem';
import { TableAccountAttachedResourceItem } from '../../table/TableAccountAttachedResourceItem';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { type PersistedAccount } from '../../v1-legacy-api/AttachedAccountsTreeItem';
import { WorkspaceResourceType } from '../../workspace-api/SharedWorkspaceResourceProvider';
import { CosmosDBAttachAccountResourceItem } from './CosmosDBAttachAccountResourceItem';
import { type CosmosDBAttachedAccountModel } from './CosmosDBAttachedAccountModel';
import { LocalCoreEmulatorsItem } from './LocalEmulators/LocalCoreEmulatorsItem';

export class CosmosDBWorkspaceItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string = WorkspaceResourceType.AttachedAccounts;
    public readonly contextValue: string = 'treeItem.accounts';

    constructor() {
        this.contextValue = createContextValue([this.contextValue, `attachedAccounts`]);
    }

    public async getChildren(): Promise<TreeElement[]> {
        // TODO: remove after a few releases
        await this.pickSupportedAccounts(); // Move accounts from the old storage format to the new one

        const items = await StorageService.get(StorageNames.Workspace).getItems(this.id);
        const children = await this.getChildrenNoEmulatorsImpl(items);

        if (isEmulatorSupported) {
            return [new LocalCoreEmulatorsItem(this.id), ...children, new CosmosDBAttachAccountResourceItem(this.id)];
        } else {
            return [...children, new CosmosDBAttachAccountResourceItem(this.id)];
        }
    }

    public getTreeItem() {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('CosmosDB Accounts'),
            iconPath: new vscode.ThemeIcon('plug'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected async getChildrenNoEmulatorsImpl(items: StorageItem[]): Promise<TreeElement[]> {
        return Promise.resolve(
            items
                .filter((item) => item.properties?.isEmulator !== true)
                .map((item) => {
                    const { id, name, properties, secrets } = item;
                    const api: API = nonNullValue(properties?.api, 'api') as API;
                    const isEmulator: boolean = !!nonNullValue(properties?.isEmulator, 'isEmulator');
                    const connectionString: string = nonNullValue(secrets?.[0], 'connectionString');
                    const experience = getExperienceFromApi(api);
                    const accountModel: CosmosDBAttachedAccountModel = {
                        id,
                        name,
                        connectionString,
                        isEmulator,
                    };

                    if (experience?.api === API.Cassandra) {
                        return new NoSqlAccountAttachedResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Core) {
                        return new NoSqlAccountAttachedResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Graph) {
                        return new GraphAccountAttachedResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Table) {
                        return new TableAccountAttachedResourceItem(accountModel, experience);
                    }

                    // Unknown experience
                    return undefined;
                })
                .filter((r) => r !== undefined),
        );
    }

    protected async pickSupportedAccounts(): Promise<void> {
        return callWithTelemetryAndErrorHandling(
            'CosmosDBAttachedAccountsResourceItem.pickSupportedAccounts',
            async () => {
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
            },
        );
    }

    protected async migrateV1AccountsToV2(): Promise<void> {
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
}
