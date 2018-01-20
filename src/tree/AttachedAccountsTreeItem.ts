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
import { Experience } from '../constants';

interface IPersistedAccount {
    id: string,
    defaultExperience: Experience
}

export const AttachedAccountSuffix: string = 'Attached';

export class AttachedAccountsTreeItem implements IAzureParentTreeItem {
    public static contextValue: string = 'cosmosDBAttachedAccounts';
    public readonly contextValue: string = AttachedAccountsTreeItem.contextValue;
    public readonly id: string = AttachedAccountsTreeItem.contextValue;
    public readonly label: string = 'Attached Database Accounts';
    public childTypeLabel: string = 'Account';

    private readonly _serviceName = "ms-azuretools.vscode-cosmosdb.connectionStrings";
    private _attachedAccounts: IAzureTreeItem[] = [];
    private _keytar: typeof keytarType;

    constructor(private readonly _globalState: vscode.Memento) {
        try {
            this._keytar = require(`${vscode.env.appRoot}/node_modules/keytar`);
        } catch (e) {
            // unable to find keytar
        }

        this.loadPersistedServers();
    }

    get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'light', 'ConnectPlugged.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'dark', 'ConnectPlugged.svg')
        };
    }

    public hasMoreChildren(): boolean {
        return false;
    }

    public async loadMoreChildren(_node: IAzureNode, clearCache: boolean): Promise<IAzureTreeItem[]> {
        return this._attachedAccounts.length > 0 ? this._attachedAccounts : [{
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
        const defaultExperience = <Experience>await vscode.window.showQuickPick(Object.keys(Experience), { placeHolder: "Select a Database Account API...", ignoreFocusOut: true });
        if (defaultExperience) {
            let placeholder: string;
            let validateInput: (value: string) => string | undefined | null;
            if (defaultExperience === Experience.MongoDB) {
                placeholder = 'mongodb://host:port';
                validateInput = AttachedAccountsTreeItem.validateMongoConnectionString;
            } else {
                placeholder = 'AccountEndpoint=...;AccountKey=...'
                validateInput = AttachedAccountsTreeItem.validateDocDBConnectionString;
            }

            const connectionString = await vscode.window.showInputBox({
                placeHolder: placeholder,
                prompt: 'Enter the connection string for your database account',
                validateInput: validateInput,
                ignoreFocusOut: true
            });

            if (connectionString) {
                let treeItem: IAzureTreeItem = await this.createTreeItem(connectionString, defaultExperience);
                if (this._attachedAccounts.find(s => s.id === treeItem.id)) {
                    vscode.window.showWarningMessage(`Database Account '${treeItem.id}' is already attached.`)
                } else {
                    this._attachedAccounts.push(treeItem);
                    if (this._keytar) {
                        await this._keytar.setPassword(this._serviceName, treeItem.id, connectionString);
                        await this.persistIds();
                    }
                }
            }
        } else {
            throw new UserCancelledError();
        }
    }

    public async detach(id: string): Promise<void> {
        const index = this._attachedAccounts.findIndex((account) => account.id === id);
        if (index !== -1) {
            this._attachedAccounts.splice(index, 1);
            if (this._keytar) {
                await this._keytar.deletePassword(this._serviceName, id);
                await this.persistIds();
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
            let rs: any = serverConfig;
            host = rs.s.replset.s.seedlist[0].host;
            port = rs.s.replset.s.seedlist[0].port;
        } else {
            host = serverConfig['host'];
            port = serverConfig['port'];
        }

        return `${host}:${port}`;
    }

    private async loadPersistedServers() {
        const value: any = this._globalState.get(this._serviceName);
        if (value && this._keytar) {
            try {
                const accounts: any[] = JSON.parse(value);
                await Promise.all(accounts.map(async account => {
                    let id: string;
                    let api: Experience;
                    if (typeof (account) === 'string') {
                        // Default to Mongo if the value is a string for the sake of backwards compatiblity
                        // (Mongo was originally the only account type that could be attached)
                        id = account;
                        api = Experience.MongoDB;
                    } else {
                        id = (<IPersistedAccount>account).id;
                        api = (<IPersistedAccount>account).defaultExperience;
                    }
                    const connectionString: string = await this._keytar.getPassword(this._serviceName, id);
                    this._attachedAccounts.push(await this.createTreeItem(connectionString, api, id));
                }));
            } catch {
                throw new Error('Failed to load persisted Database Accounts. Reattach the accounts manually.')
            }
        }
    }

    private async createTreeItem(connectionString: string, api: Experience, id?: string): Promise<IAzureTreeItem> {
        let treeItem: IAzureTreeItem;
        if (api === Experience.MongoDB) {
            if (id === undefined) {
                id = await this.getServerIdFromConnectionString(connectionString);
            }

            treeItem = new MongoAccountTreeItem(id, id, connectionString);
        } else {
            const [endpoint, masterKey, id] = AttachedAccountsTreeItem.parseDocDBConnectionString(connectionString);

            switch (api) {
                case Experience.Table:
                    treeItem = new TableAccountTreeItem(id, id, endpoint, masterKey);
                    break;
                case Experience.Graph:
                    treeItem = new GraphAccountTreeItem(id, id, endpoint, undefined, masterKey);
                    break;
                case Experience.DocumentDB:
                    treeItem = new DocDBAccountTreeItem(id, id, endpoint, masterKey);
                    break;
                default:
                    throw new Error(`Unexpected defaultExperience "${api}".`);
            }
        }

        treeItem.contextValue += AttachedAccountSuffix;
        return treeItem;
    }

    private async persistIds() {
        const value: IPersistedAccount[] = this._attachedAccounts.map((node: IAzureTreeItem) => {
            let experience: Experience;
            if (node instanceof MongoAccountTreeItem) {
                experience = Experience.MongoDB;
            } else if (node instanceof GraphAccountTreeItem) {
                experience = Experience.Graph;
            } else if (node instanceof TableAccountTreeItem) {
                experience = Experience.Table;
            } else if (node instanceof DocDBAccountTreeItem) {
                experience = Experience.DocumentDB;
            } else {
                throw new Error(`Unexpected account node "${node.constructor.name}".`);
            }
            return { id: node.id, defaultExperience: experience };
        });
        await this._globalState.update(this._serviceName, JSON.stringify(value));
    }

    private static validateMongoConnectionString(value: string): string | undefined {
        if (!value || !value.startsWith('mongodb://')) {
            return 'Connection string must start with "mongodb://"';
        }
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
