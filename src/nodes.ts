/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import * as keytarType from 'keytar';

import { MongoClient, ReplSet } from 'mongodb';
import { EventEmitter, Event, Command } from 'vscode';
import { MongoServerNode, IMongoServer } from './mongo/nodes'
import { AzureAccount, AzureResourceFilter } from './azure-account.api';
import { ResourceManagementClient } from 'azure-arm-resource';
import docDBModels = require("azure-arm-documentdb/lib/models");
import DocumentdbManagementClient = require("azure-arm-documentdb");
import { DocDBDatabaseNode } from './docdb/nodes';
import { DocumentClient } from 'documentdb';

export interface INode extends vscode.TreeItem {
	id: string;
	contextValue: string;
	getChildren?(): Promise<INode[]>;
}

export class SubscriptionNode implements INode {
	readonly contextValue: string = 'cosmosDBSubscription';
	readonly id: string;
	readonly label: string;

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	constructor(private readonly subscriptionFilter?: AzureResourceFilter) {
		this.id = subscriptionFilter.subscription.id;
		this.label = subscriptionFilter.subscription.displayName;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', 'resources', 'icons', 'light', 'AzureSubscription.svg'),
			dark: path.join(__filename, '..', '..', '..', 'resources', 'icons', 'dark', 'AzureSubscription.svg')
		};
	}

	async getChildren(): Promise<INode[]> {
		let nodes: INode[] = [];

		try {
			const docDBClient = new DocumentdbManagementClient(this.subscriptionFilter.session.credentials, this.subscriptionFilter.subscription.subscriptionId);
			const resourceManagementClient = new ResourceManagementClient(this.subscriptionFilter.session.credentials, this.subscriptionFilter.subscription.subscriptionId);
			let resourceGroups = await resourceManagementClient.resourceGroups.list();
			resourceGroups = resourceGroups.sort((a, b) => a.name.localeCompare(b.name));
			let l = await docDBClient.databaseAccounts.list();

			const result = await Promise.all(resourceGroups.map(async group => {
				let dbs = await docDBClient.databaseAccounts.listByResourceGroup(group.name);
				dbs = dbs.sort((a, b) => a.name.localeCompare(b.name));
				return Promise.all(dbs.map(async db => new CosmosDBAccountNode(this.subscriptionFilter, db, group.name)));
			}));

			nodes = [].concat(...result);
		} catch (error) {
			vscode.window.showErrorMessage(error.message);
		}

		return nodes.length > 0 ? nodes : [new NoResourcesNode()];
	}
}

export class CosmosDBAccountNode implements IMongoServer {
	readonly id: string;
	readonly label: string;
	readonly contextValue: string;
	readonly tenantId: string;
	readonly collapsibleState;
	readonly defaultExperience: string;

	private _connectionString: string;

	constructor(private readonly _subscriptionFilter: AzureResourceFilter,
		private readonly _databaseAccount: docDBModels.DatabaseAccount,
		private readonly _resourceGroupName: string) {
		this.id = _databaseAccount.id;
		this.tenantId = _subscriptionFilter.session.tenantId;
		this.label = `${_databaseAccount.name} (${_resourceGroupName})`;
		this.defaultExperience = _databaseAccount.tags.defaultExperience;

		switch (this.defaultExperience) {
			case "MongoDB":
				this.contextValue = "cosmosDBMongoServer";
				break;
			case "DocumentDB":
				this.contextValue = "cosmosDBDocumentServer"
				break;
			default:
				this.contextValue = "cosmosDBGenericResource";
		}
		this.collapsibleState = this.contextValue === "cosmosDBGenericResource" ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;
	}

	get iconPath(): any {
		if (this.defaultExperience === "MongoDB") {
			return {
				light: path.join(__filename, '..', '..', '..', 'resources', 'icons', 'light', 'DataServer.svg'),
				dark: path.join(__filename, '..', '..', '..', 'resources', 'icons', 'dark', 'DataServer.svg')
			};
		} else {
			return {
				light: path.join(__filename, '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - DocDB account LARGE.svg'),
				dark: path.join(__filename, '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - DocDB account LARGE.svg')
			};
		}
	}

	async getConnectionString(): Promise<string> {
		if (!this._connectionString) {
			const docDBClient = new DocumentdbManagementClient(this._subscriptionFilter.session.credentials, this._subscriptionFilter.subscription.subscriptionId);
			const result = await docDBClient.databaseAccounts.listConnectionStrings(this._resourceGroupName, this._databaseAccount.name);
			// Use the default connection string
			this._connectionString = result.connectionStrings[0].connectionString;
		}

		return this._connectionString;
	}

	async getPrimaryMasterKey(): Promise<string> {
		const docDBClient = new DocumentdbManagementClient(this._subscriptionFilter.session.credentials, this._subscriptionFilter.subscription.subscriptionId);
		const result = await docDBClient.databaseAccounts.listKeys(this._resourceGroupName, this._databaseAccount.name);
		return result.primaryMasterKey;
	}

	async getEndpoint(): Promise<string> {
		return await this._databaseAccount.documentEndpoint;
	}

	async getChildren(): Promise<INode[]> {
		if (this.contextValue === "cosmosDBMongoServer") {
			const connectionString = await this.getConnectionString();
			return MongoServerNode.getMongoDatabaseNodes(connectionString, this);
		}
		if (this.contextValue === "cosmosDBDocumentServer") {
			const masterKey = await this.getPrimaryMasterKey();
			let client = new DocumentClient(this._databaseAccount.documentEndpoint, { masterKey: masterKey });
			return await CosmosDBAccountNode.getDocDBDatabaseNodes(client, masterKey, await this.getEndpoint(), this.defaultExperience, this);
		}
	}

	static async getDocDBDatabaseNodes(client: DocumentClient, masterKey: string, endpoint: string, contextValue: string, server: INode): Promise<INode[]> {
		let databases = await CosmosDBAccountNode.listDatabases(client);
		return databases.map(database => new DocDBDatabaseNode(database.id, masterKey, endpoint, contextValue, server));
	}

	static async listDatabases(client): Promise<any[]> {
		let databases = await client.readDatabases();
		return await new Promise<any[]>((resolve, reject) => {
			databases.toArray((err, dbs: Array<Object>) => err ? reject(err) : resolve(dbs));
		});
	}

}

export class AttachedServersNode implements INode {
	readonly contextValue: string = 'cosmosDBAttachedServers';
	readonly id: string = 'cosmosDBAttachedServers';
	readonly label: string = 'Attached Mongo Servers';

	private readonly _serviceName = "ms-azuretools.vscode-cosmosdb.connectionStrings";
	private _attachedServers: INode[] = [];
	private _keytar: typeof keytarType;

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	constructor(private readonly _azureAccount: AzureAccount, private readonly _globalState: vscode.Memento) {
		try {
			this._keytar = require(`${vscode.env.appRoot}/node_modules/keytar`);
		} catch (e) {
			// unable to find keytar
		}

		this.loadPersistedServers();
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', 'resources', 'icons', 'light', 'ConnectPlugged.svg'),
			dark: path.join(__filename, '..', '..', '..', 'resources', 'icons', 'dark', 'ConnectPlugged.svg')
		};
	}

	async getChildren(): Promise<INode[]> {
		return this._attachedServers.length > 0 ? this._attachedServers : [new AttachMongoServerNode()];
	}

	async attach(connectionString: string): Promise<INode> {
		const id = await this.getServerIdFromConnectionString(connectionString);
		const node = new MongoServerNode(connectionString, id);
		if (this._attachedServers.find(s => s.id === node.id)) {
			vscode.window.showWarningMessage(`Mongo server '${node.id}' is already attached.`)
		} else {
			this._attachedServers.push(node);
			if (this._keytar) {
				await this._keytar.setPassword(this._serviceName, node.id, connectionString);
				await this.persistIds();
			}
			return node;
		}
	}

	async remove(server: INode): Promise<INode[]> {
		const index = this._attachedServers.findIndex((value) => value.id === server.id);
		if (index !== -1) {
			const deletedNodes = this._attachedServers.splice(index, 1);
			if (this._keytar) {
				await this._keytar.deletePassword(this._serviceName, server.id);
				await this.persistIds();
				return deletedNodes;
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
				this._attachedServers.push(new MongoServerNode(connectionString, id));
			}));
		}
	}

	private async persistIds() {
		const value = this._attachedServers.map(node => node.id);
		await this._globalState.update(this._serviceName, JSON.stringify(value));
	}
}

export class LoadingNode implements INode {
	readonly contextValue: string = 'cosmosDBLoading';
	readonly label: string = "Loading...";
	readonly id: string = "cosmosDBLoading";
}

export class AttachMongoServerNode implements INode {
	readonly contextValue: string = 'cosmosDBAttachMongoServerNode';
	readonly label: string = "Attach Mongo Server...";
	readonly id: string = "cosmosDBAttachMongoServerNode";
	readonly command: Command = {
		command: 'cosmosDB.attachMongoServer',
		title: ''
	};
}

export class NoSubscriptionsNode implements INode {
	readonly contextValue: string = 'cosmosDBNoSubscriptionsNode';
	readonly label: string = "No Azure subscriptions found. Edit filters...";
	readonly id: string = "cosmosDBNoSubscriptionsNode";
	readonly command: Command = {
		command: 'azure-account.selectSubscriptions',
		title: ''
	};
}

export class NoResourcesNode implements INode {
	readonly contextValue: string = 'cosmosDBNoResourcesNode';
	readonly label: string = "No resources found.";
	readonly id: string = "cosmosDBNoResourcesNode";
}

export class SignInToAzureNode implements INode {
	readonly contextValue: string = 'cosmosDBSignInToAzure';
	readonly label: string = "Sign in to Azure...";
	readonly id: string = "cosmosDBSignInToAzure";
	readonly command: Command = {
		command: 'azure-account.login',
		title: ''
	};
}

export class ErrorNode implements INode {
	readonly contextValue: string = 'cosmosDBErrorNode';
	readonly id: string = 'cosmosDBErrorNode';
	readonly label: string;
	constructor(errorMessage: string) {
		this.label = `Error: ${errorMessage}`;
	}
}