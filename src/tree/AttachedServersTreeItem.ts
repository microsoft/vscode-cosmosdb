/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as keytarType from 'keytar';
import { MongoClient, ReplSet } from "mongodb";
import { IAzureTreeItem, IAzureNode, IAzureParentTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';

export class AttachedServersTreeItem implements IAzureParentTreeItem {
    public static contextValue: string = 'cosmosDBAttachedServers';
    public readonly contextValue: string = AttachedServersTreeItem.contextValue;
    public readonly id: string = AttachedServersTreeItem.contextValue;
    public readonly label: string = 'Attached Mongo Servers';

    private readonly _serviceName = "ms-azuretools.vscode-cosmosdb.connectionStrings";
    private _attachedServers: IAzureTreeItem[] = [];
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
        return this._attachedServers;
    }

    public async attachNewServer(): Promise<void> {
        const connectionString = await vscode.window.showInputBox({
            placeHolder: 'mongodb://host:port',
            prompt: 'Enter the connection string for your database account',
            ignoreFocusOut: true
        });

        if (connectionString) {
            const id = await this.getServerIdFromConnectionString(connectionString);
            const node = new MongoAccountTreeItem(id, id, connectionString, 'mongoServer');
            if (this._attachedServers.find(s => s.id === node.id)) {
                vscode.window.showWarningMessage(`Mongo server '${node.id}' is already attached.`)
            } else {
                this._attachedServers.push(node);
                if (this._keytar) {
                    await this._keytar.setPassword(this._serviceName, node.id, connectionString);
                    await this.persistIds();
                }
            }
        } else {
            throw new UserCancelledError();
        }
    }

    public async detach(id: string): Promise<void> {
        const index = this._attachedServers.findIndex((value) => value.id === id);
        if (index !== -1) {
            this._attachedServers.splice(index, 1);
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
            const ids: string[] = JSON.parse(value);
            await Promise.all(ids.map(async id => {
                const connectionString: string = await this._keytar.getPassword(this._serviceName, id);
                const treeItem = new MongoAccountTreeItem(id, id, connectionString, 'mongoServer');
                this._attachedServers.push(treeItem);
            }));
        }
    }

    private async persistIds() {
        const value = this._attachedServers.map(node => node.id);
        await this._globalState.update(this._serviceName, JSON.stringify(value));
    }
}
