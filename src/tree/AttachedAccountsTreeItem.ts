/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import { TokenCredentialsBase } from '@azure/ms-rest-nodeauth';
import { MongoClient } from 'mongodb';
import * as vscode from 'vscode';
import { appendExtensionUserAgent, AzExtParentTreeItem, AzExtTreeItem, AzureParentTreeItem, AzureTreeItem, GenericTreeItem, ISubscriptionContext, UserCancelledError } from 'vscode-azureextensionui';
import { API, getExperienceFromApi, getExperienceQuickPick, getExperienceQuickPicks } from '../AzureDBExperiences';
import { removeTreeItemFromCache } from '../commands/api/apiCache';
import { emulatorPassword, getThemedIconPath, isWindows } from '../constants';
import { parseDocDBConnectionString } from '../docdb/docDBConnectionStrings';
import { DocDBAccountTreeItem } from '../docdb/tree/DocDBAccountTreeItem';
import { DocDBAccountTreeItemBase } from '../docdb/tree/DocDBAccountTreeItemBase';
import { ext } from '../extensionVariables';
import { GraphAccountTreeItem } from '../graph/tree/GraphAccountTreeItem';
import { connectToMongoClient } from '../mongo/connectToMongoClient';
import { parseMongoConnectionString } from '../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { parsePostgresConnectionString } from '../postgres/postgresConnectionStrings';
import { PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';
import { TableAccountTreeItem } from '../table/tree/TableAccountTreeItem';
import { localize } from '../utils/localize';
import { nonNullProp, nonNullValue } from '../utils/nonNull';
import { SubscriptionTreeItem } from './SubscriptionTreeItem';

interface IPersistedAccount {
    id: string;
    // defaultExperience is not the same as API but we can't change the name due to backwards compatibility
    defaultExperience: API;
    isEmulator: boolean | undefined;
}

export const AttachedAccountSuffix: string = 'Attached';
export const MONGO_CONNECTION_EXPECTED: string = 'Connection string must start with "mongodb://" or "mongodb+srv://"';

const localMongoConnectionString: string = 'mongodb://127.0.0.1:27017';

export class AttachedAccountsTreeItem extends AzureParentTreeItem {
    public static contextValue: string = 'cosmosDBAttachedAccounts' + (isWindows ? 'WithEmulator' : 'WithoutEmulator');
    public readonly contextValue: string = AttachedAccountsTreeItem.contextValue;
    public readonly id: string = 'cosmosDBAttachedAccounts';
    public readonly label: string = 'Attached Database Accounts';
    public childTypeLabel: string = 'Account';

    private readonly _serviceName: string = "ms-azuretools.vscode-cosmosdb.connectionStrings";
    private _attachedAccounts: AzureTreeItem[] | undefined;

    private _root: ISubscriptionContext;
    private _loadPersistedAccountsTask: Promise<AzureTreeItem[]>;

    constructor(parent: AzExtParentTreeItem) {
        super(parent);
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
        value = value ? value.trim() : '';

        if (value && value.match(/^mongodb(\+srv)?:\/\//)) {
            return undefined;
        }

        return MONGO_CONNECTION_EXPECTED;
    }

    public static validatePostgresConnectionString(value: string): string | undefined {
        value = value ? value.trim() : '';

        if (value && value.match(/^postgres:\/\//)) {
            return undefined;
        }

        return localize('invalidPostgresConnectionString', 'Connection string must start with "postgres://"');
    }

    private static validateDocDBConnectionString(value: string): string | undefined {
        value = value ? value.trim() : '';

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

        if (attachedAccounts.length > 0) {
            return attachedAccounts;
        } else {
            const attachDatabaseAccount = new GenericTreeItem(this, {
                contextValue: 'cosmosDBAttachDatabaseAccount',
                label: 'Attach Database Account...',
                commandId: 'cosmosDB.attachDatabaseAccount',
                includeInTreeItemPicker: true
            });
            const attachEmulator = new GenericTreeItem(this, {
                contextValue: 'cosmosDBAttachEmulator',
                label: 'Attach Emulator...',
                commandId: 'cosmosDB.attachEmulator',
                includeInTreeItemPicker: true
            });
            return isWindows ? [attachDatabaseAccount, attachEmulator] :
                [attachDatabaseAccount];
        }
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            // We have to make sure the Attached Accounts node is not shown for commands like
            // 'Open in Portal', which only work for the non-attached version
            case GraphAccountTreeItem.contextValue:
            case MongoAccountTreeItem.contextValue:
            case DocDBAccountTreeItem.contextValue:
            case TableAccountTreeItem.contextValue:
            case PostgresServerTreeItem.contextValue:
            case SubscriptionTreeItem.contextValue:
                return false;
            default:
                return true;
        }
    }

    public async attachNewAccount(): Promise<void> {
        const defaultExperiencePick = await vscode.window.showQuickPick(getExperienceQuickPicks(true), { placeHolder: "Select a Database type...", ignoreFocusOut: true });
        if (defaultExperiencePick) {
            const defaultExperience = defaultExperiencePick.data;
            let placeholder: string;
            let defaultValue: string | undefined;
            let validateInput: (value: string) => string | undefined | null;
            if (defaultExperience.api === API.MongoDB) {
                placeholder = 'mongodb://host:port';
                if (await this.canConnectToLocalMongoDB()) {
                    defaultValue = placeholder = localMongoConnectionString;
                }
                validateInput = AttachedAccountsTreeItem.validateMongoConnectionString;
            } else if (defaultExperience.api === API.Postgres) {
                placeholder = localize('attachedPostgresPlaceholder', '"postgres://username:password@host" or "postgres://username:password@host/database"');
                validateInput = AttachedAccountsTreeItem.validatePostgresConnectionString;
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

    public async attachConnectionString(connectionString: string, api: API.MongoDB | API.Core | API.Postgres): Promise<MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem> {
        const treeItem = <MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem>await this.createTreeItem(connectionString, api);
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
            let port: number | undefined;
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
            if (ext.keytar) {
                await ext.keytar.deletePassword(this._serviceName, nonNullProp(node, 'id')); // intentionally using 'id' instead of 'fullId' for the sake of backwards compatibility
                await this.persistIds(attachedAccounts);
            }

            if (node instanceof MongoAccountTreeItem) {
                const parsedCS = await parseMongoConnectionString(node.connectionString);
                removeTreeItemFromCache(parsedCS);
            } else if (node instanceof DocDBAccountTreeItemBase) {
                const parsedCS = parseDocDBConnectionString(node.connectionString);
                removeTreeItemFromCache(parsedCS);
            } else if (node instanceof PostgresServerTreeItem) {
                const parsedCS = node.partialConnectionString;
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
        async function timeout(): Promise<boolean> {
            await delay(1000);
            return false;
        }
        async function connect(): Promise<boolean> {
            try {
                const db: MongoClient = await connectToMongoClient(localMongoConnectionString, appendExtensionUserAgent());
                // grandfathered in
                // tslint:disable-next-line: no-floating-promises
                db.close();
                return true;
            } catch {
                return false;
            }
        }
        return await Promise.race([timeout(), connect()]);
    }

    private async attachAccount(treeItem: AzureTreeItem, connectionString: string): Promise<void> {
        const attachedAccounts: AzureTreeItem[] = await this.getAttachedAccounts();

        if (attachedAccounts.find(s => s.id === treeItem.id)) {
            vscode.window.showWarningMessage(`Database Account '${treeItem.id}' is already attached.`);
        } else {
            attachedAccounts.push(treeItem);
            if (ext.keytar) {
                await ext.keytar.setPassword(this._serviceName, nonNullProp(treeItem, 'id'), connectionString);
                await this.persistIds(attachedAccounts);
            }
        }
    }

    private async loadPersistedAccounts(): Promise<AzureTreeItem[]> {
        const persistedAccounts: AzureTreeItem[] = [];
        const value: string | undefined = ext.context.globalState.get(this._serviceName);
        const keytar = ext.keytar;
        if (value && keytar) {
            const accounts: (string | IPersistedAccount)[] = JSON.parse(value);
            await Promise.all(accounts.map(async account => {
                let id: string;
                let label: string;
                let api: API;
                let isEmulator: boolean | undefined;
                if (typeof (account) === 'string') {
                    // Default to Mongo if the value is a string for the sake of backwards compatibility
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
                const connectionString: string = nonNullValue(await keytar.getPassword(this._serviceName, id), 'connectionString');
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
            // tslint:disable-next-line: possible-timing-attack // not security related
        } else if (api === API.Postgres) {
            const parsedPostgresConnString = parsePostgresConnectionString(connectionString);
            treeItem = new PostgresServerTreeItem(this, parsedPostgresConnString);
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
            let isEmulator: boolean | undefined;
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
            } else if (node instanceof PostgresServerTreeItem) {
                api = API.Postgres;
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

    public get credentials(): TokenCredentialsBase {
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

    public get environment(): Environment {
        throw this._error;
    }
}

async function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => {
        // tslint:disable-next-line:no-string-based-set-timeout // false positive
        setTimeout(resolve, milliseconds);
    });
}
