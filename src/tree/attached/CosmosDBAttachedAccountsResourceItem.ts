/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, createContextValue, nonNullValue } from '@microsoft/vscode-azext-utils';
import { ThemeIcon, TreeItemCollapsibleState } from 'vscode';
import { API, getExperienceFromApi } from '../../AzureDBExperiences';
import { isLinux, isWindows } from '../../constants';
import { ext } from '../../extensionVariables';
import { type PersistedAccount } from '../AttachedAccountsTreeItem';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { GraphAccountAttachedResourceItem } from '../graph/GraphAccountAttachedResourceItem';
import { NoSqlAccountAttachedResourceItem } from '../nosql/NoSqlAccountAttachedResourceItem';
import { TableAccountAttachedResourceItem } from '../table/TableAccountAttachedResourceItem';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { WorkspaceResourceType } from '../workspace/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage, type SharedWorkspaceStorageItem } from '../workspace/SharedWorkspaceStorage';
import { CosmosDBAttachAccountResourceItem } from './CosmosDBAttachAccountResourceItem';
import { type CosmosDBAttachedAccountModel } from './CosmosDBAttachedAccountModel';
import { CosmosDBAttachEmulatorResourceItem } from './CosmosDBAttachEmulatorResourceItem';

export class CosmosDBAttachedAccountsResourceItem implements CosmosDBTreeElement, TreeElementWithContextValue {
    public readonly id: string = WorkspaceResourceType.AttachedAccounts;
    public readonly contextValue: string = 'treeItem.accounts';

    constructor() {
        this.contextValue = createContextValue([this.contextValue, `attachedAccounts`]);
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        // TODO: remove after a few releases
        await this.pickSupportedAccounts(); // Move accounts from the old storage format to the new one

        const attachDatabaseAccount = new CosmosDBAttachAccountResourceItem(this.id);
        const attachEmulator = new CosmosDBAttachEmulatorResourceItem(this.id);

        const items = await SharedWorkspaceStorage.getItems(this.id);
        const children = await this.getChildrenImpl(items);
        const auxItems = (isWindows || isLinux) ? [attachDatabaseAccount, attachEmulator] : [attachDatabaseAccount];

        return [...children, ...auxItems];
    }

    public getTreeItem() {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: 'Attached Database Accounts',
            iconPath: new ThemeIcon('plug'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }

    protected async getChildrenImpl(items: SharedWorkspaceStorageItem[]): Promise<CosmosDBTreeElement[]> {
        return Promise.resolve(
            items
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

                    const storageItem: SharedWorkspaceStorageItem = {
                        id,
                        name,
                        properties: { isEmulator, api },
                        secrets: [connectionString],
                    };

                    await SharedWorkspaceStorage.push(WorkspaceResourceType.AttachedAccounts, storageItem, true);
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

                        const storageItem: SharedWorkspaceStorageItem = {
                            id,
                            name,
                            properties: {
                                isEmulator,
                                api,
                            },
                            secrets: [connectionString],
                        };

                        await SharedWorkspaceStorage.push(WorkspaceResourceType.AttachedAccounts, storageItem);
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
