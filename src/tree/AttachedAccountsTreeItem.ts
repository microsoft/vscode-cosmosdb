/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendExtensionUserAgent, AzExtParentTreeItem, AzExtTreeItem, GenericTreeItem, IActionContext, ISubscriptionContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { MongoClient } from 'mongodb';
import * as vscode from 'vscode';
import { API, getExperienceFromApi, getExperienceQuickPick, getExperienceQuickPicks } from '../AzureDBExperiences';
import { removeTreeItemFromCache } from '../commands/api/apiCache';
import { emulatorPassword, isWindows } from '../constants';
import { parseDocDBConnectionString } from '../docdb/docDBConnectionStrings';
import { CosmosDBCredential } from '../docdb/getCosmosClient';
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
import { getSecretStorageKey } from '../utils/getSecretStorageKey';
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

export class AttachedAccountsTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'cosmosDBAttachedAccounts' + (isWindows ? 'WithEmulator' : 'WithoutEmulator');
    public readonly contextValue: string = AttachedAccountsTreeItem.contextValue;
    public readonly label: string = 'Attached Database Accounts';
    public childTypeLabel: string = 'Account';
    public suppressMaskLabel = true;

    private readonly _serviceName: string = "ms-azuretools.vscode-cosmosdb.connectionStrings";
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

        const attachedAccounts: AzExtTreeItem[] = await this.getAttachedAccounts();

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

    public async attachNewAccount(context: IActionContext): Promise<void> {
        const defaultExperiencePick = await context.ui.showQuickPick(getExperienceQuickPicks(true), { placeHolder: "Select a Database type...", stepName: 'attachNewAccount' });
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
        } else if (defaultExperience.api === API.PostgresSingle || defaultExperience.api === API.PostgresFlexible) {
            placeholder = localize('attachedPostgresPlaceholder', '"postgres://username:password@host" or "postgres://username:password@host/database"');
            validateInput = AttachedAccountsTreeItem.validatePostgresConnectionString;
        } else {
            placeholder = 'AccountEndpoint=...;AccountKey=...';
            validateInput = AttachedAccountsTreeItem.validateDocDBConnectionString;
        }

        const connectionString = (await context.ui.showInputBox({
            placeHolder: placeholder,
            prompt: 'Enter the connection string for your database account',
            stepName: 'attachNewAccountConnectionString',
            validateInput: validateInput,
            value: defaultValue
        })).trim();

        const treeItem: AzExtTreeItem = await this.createTreeItem(connectionString, defaultExperience.api);
        await this.attachAccount(context, treeItem, connectionString);
    }

    public async attachConnectionString(context: IActionContext, connectionString: string, api: API.MongoDB | API.Core | API.PostgresSingle): Promise<MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem> {
        const treeItem = <MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem>await this.createTreeItem(connectionString, api);
        await this.attachAccount(context, treeItem, connectionString);
        await this.refresh(context);
        return treeItem;
    }

    public async attachEmulator(context: IActionContext): Promise<void> {
        let connectionString: string;
        const defaultExperiencePick = await context.ui.showQuickPick(
            [
                getExperienceQuickPick(API.MongoDB),
                getExperienceQuickPick(API.Core)
            ],
            {
                placeHolder: "Select a Database Account API...",
                stepName: 'attachEmulator'
            });
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
            const treeItem: AzExtTreeItem = await this.createTreeItem(connectionString, defaultExperience.api, label);
            if (treeItem instanceof DocDBAccountTreeItem || treeItem instanceof GraphAccountTreeItem || treeItem instanceof TableAccountTreeItem || treeItem instanceof MongoAccountTreeItem) {
                // CONSIDER: Why isn't this passed in to createTreeItem above?
                treeItem.root.isEmulator = true;
            }
            await this.attachAccount(context, treeItem, connectionString);
        }
    }

    public async detach(node: AzExtTreeItem): Promise<void> {
        const attachedAccounts: AzExtTreeItem[] = await this.getAttachedAccounts();

        const index = attachedAccounts.findIndex((account) => account.fullId === node.fullId);
        if (index !== -1) {
            attachedAccounts.splice(index, 1);
            await ext.secretStorage.delete(getSecretStorageKey(this._serviceName, nonNullProp(node, 'id'))); // intentionally using 'id' instead of 'fullId' for the sake of backwards compatibility
            await this.persistIds(attachedAccounts);

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

    private async canConnectToLocalMongoDB(): Promise<boolean> {
        async function timeout(): Promise<boolean> {
            await delay(1000);
            return false;
        }
        async function connect(): Promise<boolean> {
            try {
                const db: MongoClient = await connectToMongoClient(localMongoConnectionString, appendExtensionUserAgent());
                void db.close();
                return true;
            } catch {
                return false;
            }
        }
        return await Promise.race([timeout(), connect()]);
    }

    private async attachAccount(context: IActionContext, treeItem: AzExtTreeItem, connectionString: string): Promise<void> {
        const attachedAccounts: AzExtTreeItem[] = await this.getAttachedAccounts();

        if (attachedAccounts.find(s => s.id === treeItem.id)) {
            void context.ui.showWarningMessage(`Database Account '${treeItem.id}' is already attached.`, { stepName: 'attachAccount' });
        } else {
            attachedAccounts.push(treeItem);
            await ext.secretStorage.store(getSecretStorageKey(this._serviceName, nonNullProp(treeItem, 'id')), connectionString);
            await this.persistIds(attachedAccounts);
        }
    }

    private async loadPersistedAccounts(): Promise<AzExtTreeItem[]> {
        const persistedAccounts: AzExtTreeItem[] = [];
        const value: string | undefined = ext.context.globalState.get(this._serviceName);
        if (value) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
                // TODO: keytar: migration plan?
                const connectionString: string = nonNullValue(await ext.secretStorage.get(getSecretStorageKey(this._serviceName, id)), 'connectionString');
                persistedAccounts.push(await this.createTreeItem(connectionString, api, label, id, isEmulator));
            }));
        }

        return persistedAccounts;
    }

    private async createTreeItem(connectionString: string, api: API, label?: string, id?: string, isEmulator?: boolean): Promise<AzExtTreeItem> {
        let treeItem: AzExtTreeItem;
        if (api === API.MongoDB) {
            if (id === undefined) {
                const parsedCS = await parseMongoConnectionString(connectionString);
                id = parsedCS.fullId;
            }

            label = label || `${id} (${getExperienceFromApi(api).shortName})`;
            treeItem = new MongoAccountTreeItem(this, id, label, connectionString, isEmulator);
        } else if (api === API.PostgresSingle || api === API.PostgresFlexible) {
            const parsedPostgresConnString = parsePostgresConnectionString(connectionString);
            treeItem = new PostgresServerTreeItem(this, parsedPostgresConnString);
        } else {
            const parsedCS = parseDocDBConnectionString(connectionString);

            label = label || `${parsedCS.accountId} (${getExperienceFromApi(api).shortName})`;

            const credentials: CosmosDBCredential[] = [{ type: "key", key: parsedCS.masterKey }];
            switch (api) {
                case API.Table:
                    treeItem = new TableAccountTreeItem(this, parsedCS.accountId, label, parsedCS.documentEndpoint, credentials, isEmulator);
                    break;
                case API.Graph:
                    treeItem = new GraphAccountTreeItem(this, parsedCS.accountId, label, parsedCS.documentEndpoint, undefined, credentials, isEmulator);
                    break;
                case API.Core:
                    treeItem = new DocDBAccountTreeItem(this, parsedCS.accountId, label, parsedCS.documentEndpoint, credentials, isEmulator);
                    break;
                default:
                    throw new Error(`Unexpected defaultExperience "${api}".`);
            }
        }

        treeItem.contextValue += AttachedAccountSuffix;
        return treeItem;
    }

    private async persistIds(attachedAccounts: AzExtTreeItem[]): Promise<void> {
        const value: IPersistedAccount[] = attachedAccounts.map((node: AzExtTreeItem) => {
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
                api = API.PostgresSingle;
            } else {
                throw new Error(`Unexpected account node "${node.constructor.name}".`);
            }
            return { id: nonNullProp(node, 'id'), defaultExperience: api, isEmulator: isEmulator };
        });
        await ext.context.globalState.update(this._serviceName, JSON.stringify(value));
    }
}

class AttachedAccountRoot implements ISubscriptionContext {
    private _error: Error = new Error('Cannot retrieve Azure subscription information for an attached account.');

    public get credentials(): never {
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

async function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}
