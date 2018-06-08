/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as keytarType from 'keytar';
import { MongoClient, ReplSet } from "mongodb";
import { IAzureTreeItem, IAzureNode, IAzureParentTreeItem, UserCancelledError, AzureTreeDataProvider } from 'vscode-azureextensionui';
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { GraphAccountTreeItem } from '../graph/tree/GraphAccountTreeItem';
import { TableAccountTreeItem } from '../table/tree/TableAccountTreeItem';
import { DocDBAccountTreeItem } from '../docdb/tree/DocDBAccountTreeItem';
import { tryfetchNodeModule } from '../utils/vscodeUtils';
import { getDatabaseNameFromConnectionString } from '../mongo/mongoConnectionStrings';
import { API, getExperienceQuickPicks, getExperienceQuickPick, getExperience } from '../experiences';

interface IPersistedAccount {
    id: string,
    defaultExperience: API,
    isEmulator: boolean
}

export const AttachedAccountSuffix: string = 'Attached';
export const MONGO_CONNECTION_EXPECTED: string = 'Connection string must start with "mongodb://" or "mongodb+srv://"';

export class AttachedAccountsTreeItem implements IAzureParentTreeItem {
    public static contextValue: string = 'cosmosDBAttachedAccounts';
    public readonly contextValue: string = AttachedAccountsTreeItem.contextValue;
    public readonly id: string = AttachedAccountsTreeItem.contextValue;
    public readonly label: string = 'Attached Database Accounts';
    public childTypeLabel: string = 'Account';

    private readonly _serviceName = "ms-azuretools.vscode-cosmosdb.connectionStrings";
    private _attachedAccounts: IAzureTreeItem[] | undefined;
    private _keytar: typeof keytarType;

    private _loadPersistedAccountsTask: Promise<IAzureTreeItem[]>;

    constructor(private readonly _globalState: vscode.Memento) {
        this._keytar = tryfetchNodeModule('keytar');
        this._loadPersistedAccountsTask = this.loadPersistedAccounts();
    }

    private async getAttachedAccounts(): Promise<IAzureTreeItem[]> {
        if (!this._attachedAccounts) {
            try {
                this._attachedAccounts = await this._loadPersistedAccountsTask;
            } catch {
                this._attachedAccounts = [];
                throw new Error('Failed to load persisted Database Accounts. Reattach the accounts manually.')
            }
        }

        return this._attachedAccounts;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'light', 'ConnectPlugged.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'dark', 'ConnectPlugged.svg')
        };
    }

    public hasMoreChildren(): boolean {
        return false;
    }

    public async loadMoreChildren(_node: IAzureNode, _clearCache: boolean): Promise<IAzureTreeItem[]> {
        const attachedAccounts: IAzureTreeItem[] = await this.getAttachedAccounts();

        return attachedAccounts.length > 0 ? attachedAccounts : [{
            contextValue: 'cosmosDBAttachDatabaseAccount',
            label: 'Attach Database Account...',
            id: 'cosmosDBAttachDatabaseAccount',
            commandId: 'cosmosDB.attachDatabaseAccount',
            isAncestorOf: () => { return false; }
        }];
    }

    public isAncestorOf(contextValue: string): boolean {
        switch (contextValue) {
            // We have to make sure the Attached Accounts node is not shown for commands like
            // 'Open in Portal', which only work for the non-attached version
            case GraphAccountTreeItem.contextValue:
            case MongoAccountTreeItem.contextValue:
            case DocDBAccountTreeItem.contextValue:
            case TableAccountTreeItem.contextValue:
            case AzureTreeDataProvider.subscriptionContextValue:
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
                defaultValue = placeholder = 'mongodb://127.0.0.1:27017';
                validateInput = AttachedAccountsTreeItem.validateMongoConnectionString;
            } else {
                placeholder = 'AccountEndpoint=...;AccountKey=...'
                validateInput = AttachedAccountsTreeItem.validateDocDBConnectionString;
            }

            const connectionString = await vscode.window.showInputBox({
                placeHolder: placeholder,
                prompt: 'Enter the connection string for your database account',
                validateInput: validateInput,
                ignoreFocusOut: true,
                value: defaultValue
            });

            if (connectionString) {
                let treeItem: IAzureTreeItem = await this.createTreeItem(connectionString, defaultExperience.api);
                await this.attachAccount(treeItem, connectionString);
            }
        } else {
            throw new UserCancelledError();
        }
    }

    public async attachEmulator(): Promise<void> {
        let connectionString: string;
        const defaultExperiencePick = await vscode.window.showQuickPick(
            [
                getExperienceQuickPick(API.MongoDB),
                getExperienceQuickPick(API.DocumentDB)
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
            }
            else {
                port = vscode.workspace.getConfiguration().get<number>("cosmosDB.emulator.port");
            }
            if (port) {
                if (defaultExperience.api === API.MongoDB) {
                    connectionString = `mongodb://localhost:C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==@localhost:${port}?ssl=true`;
                }
                else {
                    connectionString = `AccountEndpoint=https://localhost:${port}/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==;`;
                }
                const label = `${defaultExperience.shortName} Emulator`
                let treeItem: IAzureTreeItem = await this.createTreeItem(connectionString, defaultExperience.api, label);
                if (treeItem instanceof DocDBAccountTreeItem || treeItem instanceof GraphAccountTreeItem || treeItem instanceof TableAccountTreeItem || treeItem instanceof MongoAccountTreeItem) {
                    treeItem.isEmulator = true;
                }
                await this.attachAccount(treeItem, connectionString);
            }
        }
    }

    private async attachAccount(treeItem: IAzureTreeItem, connectionString: string): Promise<void> {
        const attachedAccounts: IAzureTreeItem[] = await this.getAttachedAccounts();

        if (attachedAccounts.find(s => s.id === treeItem.id)) {
            vscode.window.showWarningMessage(`Database Account '${treeItem.id}' is already attached.`)
        } else {
            attachedAccounts.push(treeItem);
            if (this._keytar) {
                await this._keytar.setPassword(this._serviceName, treeItem.id, connectionString);
                await this.persistIds(attachedAccounts);
            }
        }
    }

    public async detach(id: string): Promise<void> {
        const attachedAccounts: IAzureTreeItem[] = await this.getAttachedAccounts();

        const index = attachedAccounts.findIndex((account) => account.id === id);
        if (index !== -1) {
            attachedAccounts.splice(index, 1);
            if (this._keytar) {
                await this._keytar.deletePassword(this._serviceName, id);
                await this.persistIds(attachedAccounts);
            }
        }
    }

    private async getServerIdFromConnectionString(connectionString: string): Promise<string> {
        let host: string;
        let port: string;

        const db = await MongoClient.connect(connectionString);
        const serverConfig = db.serverConfig;
        // Azure CosmosDB comes back as a ReplSet
        if (serverConfig instanceof ReplSet) {
            // get the first connection string from the seedlist for the ReplSet
            // this may not be best solution, but the connection (below) gives
            // the replicaset host name, which is different than what is in the connection string
            // "s" is not part of ReplSet static definition but can't find any official documentation on it. Yet it is definitely there at runtime. Grandfathering in.
            // tslint:disable-next-line:no-any
            let rs: any = serverConfig;
            host = rs.s.replset.s.seedlist[0].host;
            port = rs.s.replset.s.seedlist[0].port;
        } else {
            host = serverConfig['host'];
            port = serverConfig['port'];
        }

        return `${host}:${port}`;
    }

    private async loadPersistedAccounts(): Promise<IAzureTreeItem[]> {
        const persistedAccounts: IAzureTreeItem[] = [];
        const value: string | undefined = this._globalState.get(this._serviceName);
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
                    label = `${account} (${getExperience(api).shortName})`;
                    isEmulator = false;
                } else {
                    id = (<IPersistedAccount>account).id;
                    api = (<IPersistedAccount>account).defaultExperience;
                    isEmulator = (<IPersistedAccount>account).isEmulator;
                    label = isEmulator ? `${getExperience(api).shortName} Emulator` : `${id} (${getExperience(api).shortName})`;
                }
                const connectionString: string = await this._keytar.getPassword(this._serviceName, id);
                persistedAccounts.push(await this.createTreeItem(connectionString, api, label, id, isEmulator));
            }));
        }

        return persistedAccounts;
    }

    private async createTreeItem(connectionString: string, api: API, label?: string, id?: string, isEmulator?: boolean): Promise<IAzureTreeItem> {
        let treeItem: IAzureTreeItem;
        // tslint:disable-next-line:possible-timing-attack // not security related
        if (api === API.MongoDB) {
            if (id === undefined) {
                id = await this.getServerIdFromConnectionString(connectionString);

                // Add database to node id if specified in connection string
                let database = !isEmulator && getDatabaseNameFromConnectionString(connectionString);
                if (database) {
                    id = `${id}/${database}`;
                }
            }

            label = label || `${id} (${getExperience(api).shortName})`;
            treeItem = new MongoAccountTreeItem(id, label, connectionString, isEmulator);
        } else {
            const [endpoint, masterKey, id] = AttachedAccountsTreeItem.parseDocDBConnectionString(connectionString);

            label = label || `${id} (${getExperience(api).shortName})`;
            switch (api) {
                case API.Table:
                    treeItem = new TableAccountTreeItem(id, label, endpoint, masterKey, isEmulator);
                    break;
                case API.Graph:
                    treeItem = new GraphAccountTreeItem(id, label, endpoint, undefined, masterKey, isEmulator);
                    break;
                case API.DocumentDB:
                    treeItem = new DocDBAccountTreeItem(id, label, endpoint, masterKey, isEmulator);
                    break;
                default:
                    throw new Error(`Unexpected defaultExperience "${api}".`);
            }
        }

        treeItem.contextValue += AttachedAccountSuffix;
        return treeItem;
    }

    private async persistIds(attachedAccounts: IAzureTreeItem[]) {
        const value: IPersistedAccount[] = attachedAccounts.map((node: IAzureTreeItem) => {
            let experience: API;
            let isEmulator: boolean;
            if (node instanceof MongoAccountTreeItem || node instanceof DocDBAccountTreeItem || node instanceof GraphAccountTreeItem || node instanceof TableAccountTreeItem) {
                isEmulator = node.isEmulator;
            }
            if (node instanceof MongoAccountTreeItem) {
                experience = API.MongoDB;
            } else if (node instanceof GraphAccountTreeItem) {
                experience = API.Graph;
            } else if (node instanceof TableAccountTreeItem) {
                experience = API.Table;
            } else if (node instanceof DocDBAccountTreeItem) {
                experience = API.DocumentDB;
            } else {
                throw new Error(`Unexpected account node "${node.constructor.name}".`);
            }
            return { id: node.id, defaultExperience: experience, isEmulator: isEmulator };
        });
        await this._globalState.update(this._serviceName, JSON.stringify(value));
    }

    static validateMongoConnectionString(value: string): string | undefined {
        if (value && value.match(/^mongodb(\+srv)?:\/\//)) {
            return undefined;
        }
        return MONGO_CONNECTION_EXPECTED;
    }

    private static validateDocDBConnectionString(value: string): string | undefined {
        try {
            const [endpoint, masterKey, id] = AttachedAccountsTreeItem.parseDocDBConnectionString(value);
            if (endpoint && masterKey) {
                if (id) {
                    return undefined;
                } else {
                    return 'AccountEndpoint is invalid url.';
                }
            }
        } catch (error) {
            // Swallow specific errors, show error message below
        }

        return 'Connection string must be of the form "AccountEndpoint=...;AccountKey=..."';
    }

    private static parseDocDBConnectionString(value: string): [string, string, string] {
        const matches = value.match(/AccountEndpoint=(.*);AccountKey=(.*)/);
        const endpoint = matches[1];
        const masterKey = matches[2];
        const id = vscode.Uri.parse(endpoint).authority;
        return [endpoint, masterKey, id];
    }
}
