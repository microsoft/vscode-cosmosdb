/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    nonNullValue,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import vscode, { ThemeIcon, TreeItemCollapsibleState } from 'vscode';
import { API, getExperienceFromApi } from '../../AzureDBExperiences';
import { isWindows } from '../../constants';
import { ext } from '../../extensionVariables';
import { type IPersistedAccount } from '../AttachedAccountsTreeItem';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { GraphAccountAttachedResourceItem } from '../graph/GraphAccountAttachedResourceItem';
import { NoSqlAccountAttachedResourceItem } from '../nosql/NoSqlAccountAttachedResourceItem';
import { TableAccountAttachedResourceItem } from '../table/TableAccountAttachedResourceItem';
import { WorkspaceResourceType } from '../workspace/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage, type SharedWorkspaceStorageItem } from '../workspace/SharedWorkspaceStorage';
import { type CosmosDBAttachedAccountModel } from './CosmosDBAttachedAccountModel';

export class CosmosDBAttachedAccountsResourceItem implements CosmosDBTreeElement {
    public id: string = WorkspaceResourceType.AttachedAccounts;
    public contextValue: string = 'cosmosDB.workspace.item.accounts';

    private readonly attachDatabaseAccount: CosmosDBTreeElement;
    private readonly attachEmulator: CosmosDBTreeElement;

    constructor() {
        this.attachDatabaseAccount = createGenericElement({
            id: `${this.id}/attachAccount`,
            contextValue: `${this.contextValue}/attachAccount`,
            label: 'Attach Database Account\u2026',
            iconPath: new vscode.ThemeIcon('plus'),
            commandId: 'cosmosDB.attachDatabaseAccount',
            includeInTreeItemPicker: true,
        }) as CosmosDBTreeElement;

        this.attachEmulator = createGenericElement({
            id: `${this.id}/attachEmulator`,
            contextValue: `${this.contextValue}/attachEmulator`,
            label: 'Attach Emulator\u2026',
            iconPath: new vscode.ThemeIcon('plus'),
            commandId: 'cosmosDB.attachEmulator',
            includeInTreeItemPicker: true,
        }) as CosmosDBTreeElement;
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const items = await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = 'workspace';
            context.telemetry.properties.parentContext = this.contextValue;

            // TODO: remove after a few releases
            await this.migrateV1AccountsToV2(); // Move accounts from the old storage format to the new one

            const items = await SharedWorkspaceStorage.getItems(this.id);

            return await this.getChildrenImpl(items);
        });

        const auxItems = isWindows ? [this.attachDatabaseAccount, this.attachEmulator] : [this.attachDatabaseAccount];

        const result: CosmosDBTreeElement[] = [];
        result.push(...(items ?? []));
        result.push(...auxItems);

        return result;
    }

    public getTreeItem() {
        return {
            id: this.id,
            contextValue: 'cosmosDB.workspace.item.accounts',
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

    protected async migrateV1AccountsToV2(): Promise<void> {
        const serviceName = 'ms-azuretools.vscode-cosmosdb.connectionStrings';
        const value: string | undefined = ext.context.globalState.get(serviceName);

        if (!value) {
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const accounts: (string | IPersistedAccount)[] = JSON.parse(value);
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
                            id = (<IPersistedAccount>account).id;
                            name = (<IPersistedAccount>account).id;
                            api = (<IPersistedAccount>account).defaultExperience;
                            isEmulator = (<IPersistedAccount>account).isEmulator ?? false;
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
