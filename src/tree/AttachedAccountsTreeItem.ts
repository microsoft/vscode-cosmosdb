/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServiceClientCredentials } from 'ms-rest';
import { AzureEnvironment } from 'ms-rest-azure';
import * as vscode from 'vscode';
import { appendExtensionUserAgent, AzExtParentTreeItem, AzExtTreeItem, AzureParentTreeItem, AzureTreeItem, GenericTreeItem, ISubscriptionContext, UserCancelledError } from 'vscode-azureextensionui';
import { removeTreeItemFromCache } from '../commands/api/apiCache';
import { emulatorPassword, getThemedIconPath } from '../constants';
import { parseDocDBConnectionString } from '../docdb/docDBConnectionStrings';
import { DocDBAccountTreeItem } from '../docdb/tree/DocDBAccountTreeItem';
import { DocDBAccountTreeItemBase } from '../docdb/tree/DocDBAccountTreeItemBase';
import { API, getExperienceFromApi, getExperienceQuickPick, getExperienceQuickPicks } from '../experiences';
import { ext } from '../extensionVariables';
import { GraphAccountTreeItem } from '../graph/tree/GraphAccountTreeItem';
import { connectToMongoClient } from '../mongo/connectToMongoClient';
import { parseMongoConnectionString } from '../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { TableAccountTreeItem } from '../table/tree/TableAccountTreeItem';
import { KeyTar, tryGetKeyTar } from '../utils/keytar';
import { SubscriptionTreeItem } from './SubscriptionTreeItem';

interface IPersistedAccount {
    id: string;
    // defaultExperience is not the same as API but we can't change the name due to backwards compatibility
    defaultExperience: API;
    isEmulator: boolean;
}

export const AttachedAccountSuffix: string = 'Attached';
export const MONGO_CONNECTION_EXPECTED: string = 'Connection string must start with "mongodb://" or "mongodb+srv://"';

const localMongoConnectionString: string = 'mongodb://127.0.0.1:27017';

export class AttachedAccountsTreeItem extends AzureParentTreeItem {
    public static contextValue: string = 'cosmosDBAttachedAccounts' + (process.platform === 'win32' ? 'WithEmulator' : 'WithoutEmulator');
    public readonly contextValue: string = AttachedAccountsTreeItem.contextValue;
    public readonly id: string = 'cosmosDBAttachedAccounts';
    public readonly label: string = 'Attached Database Accounts';
    public childTypeLabel: string = 'Account';

    private readonly _serviceName: string = "ms-azuretools.vscode-cosmosdb.connectionStrings";
    private _attachedAccounts: AzureTreeItem[] | undefined;
    private _keytar: KeyTar;

    private _root: ISubscriptionContext;
    private _loadPersistedAccountsTask: Promise<AzureTreeItem[]>;

    constructor(parent: AzExtParentTreeItem) {
        super(parent);
        this._keytar = tryGetKeyTar();
        this._root = new AttachedAccountRoot();
        this._loadPersistedAccountsTask = this.loadPersistedAccounts();
    }

    public get root(): ISubscriptionContext {
        return this._root;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemedIconPath('ConnectPlugged.svg');
    }

    public static validateMongoConnectionString(value: string): string | undefined {
        value = value.trim();

        if (value && value.match(/^mongodb(\+srv)?:\/\//)) {
            return undefined;
        }

        return MONGO_CONNECTION_EXPECTED;
    }

    private static validateDocDBConnectionString(value: string): string | undefined {
        value = value.trim();

        try {
            parseDocDBConnectionString(value);
            return undefined;
        } catch (error) {
            return 'Connection string must be of the form "AccountEndpoint=...;AccountKey=..."';
        }
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            this._attachedAccounts = undefined;
            this._loadPersistedAccountsTask = this.loadPersistedAccounts();
        }

        const attachedAccounts: AzureTreeItem[] = await this.getAttachedAccounts();

        return attachedAccounts.length > 0 ? attachedAccounts : [new GenericTreeItem(this, {
            contextValue: 'cosmosDBAttachDatabaseAccount',
            label: 'Attach Database Account...',
            commandId: 'cosmosDB.attachDatabaseAccount',
            includeInTreeItemPicker: true
        })];
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            // We have to make sure the Attached Accounts node is not shown for commands like
            // 'Open in Portal', which only work for the non-attached version
            case GraphAccountTreeItem.contextValue:
            case MongoAccountTreeItem.contextValue:
            case DocDBAccountTreeItem.contextValue:
            case TableAccountTreeItem.contextValue:
            case SubscriptionTreeItem.contextValue:
                return false;
            default:
                return true;
        }
    }

    public async attachNewAccount(): Promise<void> {
        const defaultExperiencePick = await vscode.window.showQuickPick(getExperienceQuickPicks(), { placeHolder: "Select a Database Account API...", ignoreFocusOut: true });
        if (defaultExperiencePick) {
            const defaultExperience = defaultExperiencePick.data;
            let placeholder: string;
            let defaultValue: string;
            let validateInput: (value: string) => string | undefined | null;
            if (defaultExperience.api === API.MongoDB) {
                placeholder = 'mongodb://host:port';
                if (await this.canConnectToLocalMongoDB()) {
                    defaultValue = placeholder = localMongoConnectionString;
                }
                validateInput = AttachedAccountsTreeItem.validateMongoConnectionString;
            } else {
                placeholder = 'AccountEndpoint=...;AccountKey=...';
                validateInput = AttachedAccountsTreeItem.validateDocDBConnectionString;
            }

            const connectionString = (await ext.ui.showInputBox({
                placeHolder: placeholder,
                prompt: 'Enter the connection string for your database account',
                validateInput: validateInput,
                ignoreFocusOut: true,
                value: defaultValue
            })).trim();

            if (connectionString) {
                const treeItem: AzureTreeItem = await this.createTreeItem(connectionString, defaultExperience.api);
                await this.attachAccount(treeItem, connectionString);
            }
        } else {
            throw new UserCancelledError();
        }
    }

    public async attachConnectionString(connectionString: string, api: API.MongoDB | API.Core): Promise<MongoAccountTreeItem | DocDBAccountTreeItemBase> {
        const treeItem = <MongoAccountTreeItem | DocDBAccountTreeItemBase>await this.createTreeItem(connectionString, api);
        await this.attachAccount(treeItem, connectionString);
        await this.refresh();
        return treeItem;
    }

    public async attachEmulator(): Promise<void> {
        let connectionString: string;
        const defaultExperiencePick = await vscode.window.showQuickPick(
            [
                getExperienceQuickPick(API.MongoDB),
                getExperienceQuickPick(API.Core)
            ],
            {
                placeHolder: "Select a Database Account API...",
                ignoreFocusOut: true
            });
        if (defaultExperiencePick) {
            const defaultExperience = defaultExperiencePick.data;
            let port: number;
            if (defaultExperience.api === API.MongoDB) {
                port = vscode.workspace.getConfiguration().get<number>("cosmosDB.emulator.mongoPort");
            } else {
                port = vscode.workspace.getConfiguration().get<number>("cosmosDB.emulator.port");
            }
            if (port) {
                if (defaultExperience.api === API.MongoDB) {
                    // Mongo shell doesn't parse passwords with slashes, so we need to URI encode it. The '/' before the options is required by mongo conventions
                    connectionString = `mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:${port}/?ssl=true`;
                } else {
                    connectionString = `AccountEndpoint=https://localhost:${port}/;AccountKey=${emulatorPassword};`;
                }
                const label = `${defaultExperience.shortName} Emulator`;
                const treeItem: AzureTreeItem = await this.createTreeItem(connectionString, defaultExperience.api, label);
                if (treeItem instanceof DocDBAccountTreeItem || treeItem instanceof GraphAccountTreeItem || treeItem instanceof TableAccountTreeItem || treeItem instanceof MongoAccountTreeItem) {
                    // CONSIDER: Why isn't this passed in to createTreeItem above?
                    treeItem.root.isEmulator = true;
                }
                await this.attachAccount(treeItem, connectionString);
            }
        }
    }

    public async detach(node: AzureTreeItem): Promise<void> {
        const attachedAccounts: AzureTreeItem[] = await this.getAttachedAccounts();

        const index = attachedAccounts.findIndex((account) => account.fullId === node.fullId);
        if (index !== -1) {
            attachedAccounts.splice(index, 1);
            if (this._keytar) {
                await this._keytar.deletePassword(this._serviceName, node.id); // intentionally using 'id' instead of 'fullId' for the sake of backwards compatability
                await this.persistIds(attachedAccounts);
            }

            if (node instanceof MongoAccountTreeItem) {
                const parsedCS = await parseMongoConnectionString(node.connectionString);
                removeTreeItemFromCache(parsedCS);
            } else if (node instanceof DocDBAccountTreeItemBase) {
                const parsedCS = parseDocDBConnectionString(node.connectionString);
                removeTreeItemFromCache(parsedCS);
            }
        }
    }

    private async getAttachedAccounts(): Promise<AzureTreeItem[]> {
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

    private async canConnectToLocalMongoDB(): Promise<boolean> {
        try {
            const db = await connectToMongoClient(localMongoConnectionString, appendExtensionUserAgent());
            // grandfathered in
            // tslint:disable-next-line: no-floating-promises
            db.close();
            return true;
        } catch (error) {
            return false;
        }
    }

    private async attachAccount(treeItem: AzureTreeItem, connectionString: string): Promise<void> {
        const attachedAccounts: AzureTreeItem[] = await this.getAttachedAccounts();

        if (attachedAccounts.find(s => s.id === treeItem.id)) {
            vscode.window.showWarningMessage(`Database Account '${treeItem.id}' is already attached.`);
        } else {
            attachedAccounts.push(treeItem);
            if (this._keytar) {
                await this._keytar.setPassword(this._serviceName, treeItem.id, connectionString);
                await this.persistIds(attachedAccounts);
            }
        }
    }

    private async loadPersistedAccounts(): Promise<AzureTreeItem[]> {
        const persistedAccounts: AzureTreeItem[] = [];
        const value: string | undefined = ext.context.globalState.get(this._serviceName);
        if (value && this._keytar) {
            const accounts: (string | IPersistedAccount)[] = JSON.parse(value);
            await Promise.all(accounts.map(async account => {
                let id: string;
                let label: string;
                let api: API;
                let isEmulator: boolean;
                if (typeof (account) === 'string') {
                    // Default to Mongo if the value is a string for the sake of backwards compatiblity
                    // (Mongo was originally the only account type that could be attached)
                    id = account;
                    api = API.MongoDB;
                    label = `${account} (${getExperienceFromApi(api).shortName})`;
                    isEmulator = false;
                } else {
                    id = (<IPersistedAccount>account).id;
                    api = (<IPersistedAccount>account).defaultExperience;
                    isEmulator = (<IPersistedAccount>account).isEmulator;
                    label = isEmulator ? `${getExperienceFromApi(api).shortName} Emulator` : `${id} (${getExperienceFromApi(api).shortName})`;
                }
                const connectionString: string = await this._keytar.getPassword(this._serviceName, id);
                persistedAccounts.push(await this.createTreeItem(connectionString, api, label, id, isEmulator));
            }));
        }

        return persistedAccounts;
    }

    private async createTreeItem(connectionString: string, api: API, label?: string, id?: string, isEmulator?: boolean): Promise<AzureTreeItem> {
        let treeItem: AzureTreeItem;
        // tslint:disable-next-line:possible-timing-attack // not security related
        if (api === API.MongoDB) {
            if (id === undefined) {
                const parsedCS = await parseMongoConnectionString(connectionString);
                id = parsedCS.fullId;
            }

            label = label || `${id} (${getExperienceFromApi(api).shortName})`;
            treeItem = new MongoAccountTreeItem(this, id, label, connectionString, isEmulator);
        } else {
            const parsedCS = parseDocDBConnectionString(connectionString);

            label = label || `${parsedCS.accountId} (${getExperienceFromApi(api).shortName})`;
            switch (api) {
                case API.Table:
                    treeItem = new TableAccountTreeItem(this, parsedCS.accountId, label, parsedCS.documentEndpoint, parsedCS.masterKey, isEmulator);
                    break;
                case API.Graph:
                    treeItem = new GraphAccountTreeItem(this, parsedCS.accountId, label, parsedCS.documentEndpoint, undefined, parsedCS.masterKey, isEmulator);
                    break;
                case API.Core:
                    treeItem = new DocDBAccountTreeItem(this, parsedCS.accountId, label, parsedCS.documentEndpoint, parsedCS.masterKey, isEmulator);
                    break;
                default:
                    throw new Error(`Unexpected defaultExperience "${api}".`);
            }
        }

        treeItem.contextValue += AttachedAccountSuffix;
        return treeItem;
    }

    private async persistIds(attachedAccounts: AzureTreeItem[]): Promise<void> {
        const value: IPersistedAccount[] = attachedAccounts.map((node: AzureTreeItem) => {
            let api: API;
            let isEmulator: boolean;
            if (node instanceof MongoAccountTreeItem || node instanceof DocDBAccountTreeItem || node instanceof GraphAccountTreeItem || node instanceof TableAccountTreeItem) {
                isEmulator = node.root.isEmulator;
            }
            if (node instanceof MongoAccountTreeItem) {
                api = API.MongoDB;
            } else if (node instanceof GraphAccountTreeItem) {
                api = API.Graph;
            } else if (node instanceof TableAccountTreeItem) {
                api = API.Table;
            } else if (node instanceof DocDBAccountTreeItem) {
                api = API.Core;
            } else {
                throw new Error(`Unexpected account node "${node.constructor.name}".`);
            }
            return { id: node.id, defaultExperience: api, isEmulator: isEmulator };
        });
        await ext.context.globalState.update(this._serviceName, JSON.stringify(value));
    }
}

class AttachedAccountRoot implements ISubscriptionContext {
    private _error: Error = new Error('Cannot retrieve Azure subscription information for an attached account.');

    public get credentials(): ServiceClientCredentials {
        throw this._error;
    }

    public get subscriptionDisplayName(): string {
        throw this._error;
    }

    public get subscriptionId(): string {
        throw this._error;
    }

    public get subscriptionPath(): string {
        throw this._error;
    }

    public get tenantId(): string {
        throw this._error;
    }

    public get userId(): string {
        throw this._error;
    }

    public get environment(): AzureEnvironment {
        throw this._error;
    }
}
