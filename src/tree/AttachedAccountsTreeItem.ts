/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzExtParentTreeItem,
    GenericTreeItem,
    type AzExtTreeItem,
    type IActionContext,
    type ISubscriptionContext,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { API, getExperienceFromApi } from '../AzureDBExperiences';
import { removeTreeItemFromCache } from '../commands/api/apiCache';
import { isLinux, isWindows } from '../constants';
import { ext } from '../extensionVariables';
import { parsePostgresConnectionString } from '../postgres/postgresConnectionStrings';
import { PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';
import { getSecretStorageKey } from '../utils/getSecretStorageKey';
import { nonNullProp, nonNullValue } from '../utils/nonNull';

export interface PersistedAccount {
    id: string;
    // defaultExperience is not the same as API but we can't change the name due to backwards compatibility
    defaultExperience: API;
    isEmulator: boolean | undefined;
}

export interface PersistedAccountWithConnectionString {
    api: API;
    connectionString: string;
    id: string;
    isEmulator: boolean | undefined;
    label: string;
}

export const AttachedAccountSuffix: string = 'Attached';

export class AttachedAccountsTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'cosmosDBAttachedAccounts' + ((isWindows || isLinux) ? 'WithEmulator' : 'WithoutEmulator');
    public static readonly serviceName: string = 'ms-azuretools.vscode-cosmosdb.connectionStrings';
    public readonly contextValue: string = AttachedAccountsTreeItem.contextValue;
    public readonly label: string = 'Attached Database Accounts (Postgres)';
    public childTypeLabel: string = 'Account';
    public suppressMaskLabel = true;

    private _attachedAccounts: AzExtTreeItem[] | undefined;

    private _root: ISubscriptionContext;
    private _loadPersistedAccountsTask: Promise<AzExtTreeItem[]>;

    constructor(parent: AzExtParentTreeItem) {
        super(parent);
        this._root = new AttachedAccountRoot();
        this._loadPersistedAccountsTask = this.loadPersistedAccounts();
        this.id = 'cosmosDBAttachedAccounts';
    }

    public get root(): ISubscriptionContext {
        return this._root;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('plug');
    }

    public static async getPersistedAccounts(): Promise<PersistedAccountWithConnectionString[]> {
        const persistedAccounts: PersistedAccountWithConnectionString[] = [];
        const value: string | undefined = ext.context.globalState.get(AttachedAccountsTreeItem.serviceName);
        if (value) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const accounts: (string | PersistedAccount)[] = JSON.parse(value);
            await Promise.all(
                accounts.map(async (account) => {
                    let id: string;
                    let label: string;
                    let api: API;
                    let isEmulator: boolean | undefined;
                    if (typeof account === 'string') {
                        // Default to Mongo if the value is a string for the sake of backwards compatibility
                        // (Mongo was originally the only account type that could be attached)
                        id = account;
                        api = API.MongoDB;
                        label = `${account} (${getExperienceFromApi(api).shortName})`;
                        isEmulator = false;
                    } else {
                        id = (<PersistedAccount>account).id;
                        api = (<PersistedAccount>account).defaultExperience;
                        isEmulator = (<PersistedAccount>account).isEmulator;
                        label = isEmulator
                            ? `${getExperienceFromApi(api).shortName} Emulator`
                            : `${id} (${getExperienceFromApi(api).shortName})`;
                    }
                    // TODO: keytar: migration plan?
                    const connectionString: string = nonNullValue(
                        await ext.secretStorage.get(getSecretStorageKey(AttachedAccountsTreeItem.serviceName, id)),
                        'connectionString',
                    );
                    // TODO: Left only Postgres, other types are moved to new tree api v2
                    if (api === API.PostgresSingle || api === API.PostgresFlexible) {
                        persistedAccounts.push({
                            api: api,
                            id: id,
                            label: label,
                            connectionString: connectionString,
                            isEmulator: isEmulator,
                        });
                    }
                }),
            );
        }

        return persistedAccounts;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            this._attachedAccounts = undefined;
            this._loadPersistedAccountsTask = this.loadPersistedAccounts();
        }

        let attachedAccounts: AzExtTreeItem[] = [];
        try {
            attachedAccounts = await this.getAttachedAccounts();
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(errorMessage);
        }

        return [...this.getAttachAccountActionItems(), ...attachedAccounts];
    }

    private getAttachAccountActionItems(): AzExtTreeItem[] {
        const attachDatabaseAccount = new GenericTreeItem(this, {
            contextValue: 'cosmosDBAttachDatabaseAccount',
            label: 'Attach Database Account...',
            iconPath: new vscode.ThemeIcon('plus'),
            commandId: 'cosmosDB.attachDatabaseAccount',
            includeInTreeItemPicker: true,
        });
        return [attachDatabaseAccount];
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            // We have to make sure the Attached Accounts node is not shown for commands like
            // 'Open in Portal', which only work for the non-attached version
            case PostgresServerTreeItem.contextValue:
                return false;
            default:
                return true;
        }
    }

    public async attachConnectionString(
        context: IActionContext,
        connectionString: string,
        api: API.PostgresSingle | API.PostgresFlexible,
    ): Promise<PostgresServerTreeItem> {
        const treeItem = <PostgresServerTreeItem>await this.createTreeItem(connectionString, api);
        await this.attachAccount(context, treeItem, connectionString);
        await this.refresh(context);
        return treeItem;
    }

    public async detach(node: AzExtTreeItem): Promise<void> {
        const attachedAccounts: AzExtTreeItem[] = await this.getAttachedAccounts();

        const index = attachedAccounts.findIndex((account) => account.fullId === node.fullId);
        if (index !== -1) {
            attachedAccounts.splice(index, 1);
            await ext.secretStorage.delete(
                getSecretStorageKey(AttachedAccountsTreeItem.serviceName, nonNullProp(node, 'id')),
            ); // intentionally using 'id' instead of 'fullId' for the sake of backwards compatibility
            await this.persistIds(attachedAccounts);

            if (node instanceof PostgresServerTreeItem) {
                const parsedCS = node.partialConnectionString;
                removeTreeItemFromCache(parsedCS);
            }
        }
    }

    private async getAttachedAccounts(): Promise<AzExtTreeItem[]> {
        if (!this._attachedAccounts) {
            try {
                this._attachedAccounts = await this._loadPersistedAccountsTask;
            } catch {
                this._attachedAccounts = [];
                throw new Error('Failed to load persisted Database Accounts. Reattach the accounts manually.');
            }
        }

        return this._attachedAccounts;
    }

    private async attachAccount(
        context: IActionContext,
        treeItem: AzExtTreeItem,
        connectionString: string,
    ): Promise<void> {
        const attachedAccounts: AzExtTreeItem[] = await this.getAttachedAccounts();

        if (attachedAccounts.find((s) => s.id === treeItem.id)) {
            void context.ui.showWarningMessage(`Database Account '${treeItem.id}' is already attached.`, {
                stepName: 'attachAccount',
            });
        } else {
            attachedAccounts.push(treeItem);
            await ext.secretStorage.store(
                getSecretStorageKey(AttachedAccountsTreeItem.serviceName, nonNullProp(treeItem, 'id')),
                connectionString,
            );
            await this.persistIds(attachedAccounts);
        }
    }

    private async loadPersistedAccounts(): Promise<AzExtTreeItem[]> {
        const persistedAccounts = await AttachedAccountsTreeItem.getPersistedAccounts();

        return Promise.all(
            persistedAccounts.map((account) => {
                const { connectionString, api, id, label, isEmulator } = account;
                return this.createTreeItem(connectionString, api, label, id, isEmulator);
            }),
        );
    }

    private async createTreeItem(
        connectionString: string,
        api: API,
        _label?: string,
        _id?: string,
        _isEmulator?: boolean,
    ): Promise<AzExtTreeItem> {
        let treeItem: AzExtTreeItem;
        if (api === API.PostgresSingle || api === API.PostgresFlexible) {
            const parsedPostgresConnString = parsePostgresConnectionString(connectionString);
            treeItem = new PostgresServerTreeItem(this, parsedPostgresConnString);
        } else {
            throw new Error(`Unexpected defaultExperience "${api}".`);
        }

        treeItem.contextValue += AttachedAccountSuffix;
        return treeItem;
    }

    private async persistIds(attachedAccounts: AzExtTreeItem[]): Promise<void> {
        const value: PersistedAccount[] = attachedAccounts.map((node: AzExtTreeItem) => {
            let api: API;
            if (node instanceof PostgresServerTreeItem) {
                api = API.PostgresSingle;
            } else {
                throw new Error(`Unexpected account node "${node.constructor.name}".`);
            }
            return { id: nonNullProp(node, 'id'), defaultExperience: api, isEmulator: false };
        });
        await ext.context.globalState.update(AttachedAccountsTreeItem.serviceName, JSON.stringify(value));
    }
}

class AttachedAccountRoot implements ISubscriptionContext {
    private _error: Error = new Error('Cannot retrieve Azure subscription information for an attached account.');

    public get credentials(): never {
        throw this._error;
    }

    public createCredentialsForScopes(): never {
        throw this._error;
    }

    public get subscriptionDisplayName(): never {
        throw this._error;
    }

    public get subscriptionId(): never {
        throw this._error;
    }

    public get subscriptionPath(): never {
        throw this._error;
    }

    public get tenantId(): never {
        throw this._error;
    }

    public get userId(): never {
        throw this._error;
    }

    public get environment(): never {
        throw this._error;
    }

    public get isCustomCloud(): never {
        throw this._error;
    }
}
