/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as vm from 'vm';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { MongoClient, Db, ReadPreference, Code, Server as MongoServer, Collection as MongoCollection, Cursor, ObjectID, MongoError, ReplSet } from 'mongodb';
import { Shell } from './shell';
import { EventEmitter, Event, Command } from 'vscode';
import { AzureAccount } from '../azure-account.api';
import { ResourceManagementClient } from 'azure-arm-resource';
import docDBModels = require("azure-arm-documentdb/lib/models");
import DocumentdbManagementClient = require("azure-arm-documentdb");

export interface IMongoResource extends vscode.TreeItem {
	id: string
	label: string;
	getChildren?(): Thenable<IMongoResource[]>;
	onChange?: Event<void>
	contextValue?: string;
	command?: Command;
	iconPath?: { light: string, dark: string };
}

export class Model implements IMongoResource {

	readonly id: string = 'cosmosDBExplorer';
	readonly label: string = 'Cosmos DB';
	readonly type: string = 'cosmosDBRoot';
	readonly canHaveChildren: boolean = true;

	private _azureServers: IMongoResource[] = [];
	private _servers: IMongoResource[] = [];
	private _isLoading: boolean = false;
	
	private _onChange: EventEmitter<void> = new EventEmitter<void>();
	readonly onChange: Event<void> = this._onChange.event;

	constructor(private azureAccount: AzureAccount) {
	}

	async getChildren(): Promise<IMongoResource[]> {
		let azureServers = this._azureServers;

		if (this._isLoading || this.azureAccount.status === "Initializing" || this.azureAccount.status === "LoggingIn") {
			azureServers = [new LoadingNode()];
		} else if (this.azureAccount.status === "LoggedOut") {
			azureServers = [new SignInToAzureNode()];
		} else if (azureServers.length === 0) {
			azureServers = [new AddResourceFilterNode()];
		}

		return azureServers.concat(this._servers);
	}

	async add(connectionString: string) {
		try {
			const db = await MongoClient.connect(connectionString);
			const server = new Server(connectionString, db.serverConfig);
			if (this._servers.find(s => s.id === server.id)) {
				vscode.window.showWarningMessage(`Server '${server.id}' is already connected.`)
			} else {
				this._servers.push(server);
				this._onChange.fire();
			}
		} catch (error) {
			vscode.window.showErrorMessage(error.message);
		}
	}

	remove(server: IMongoResource) {
		const index = this._servers.findIndex((value) => value.id === server.id);
		if (index !== -1) {
			this._servers.splice(index, 1);
			this._onChange.fire();
		}
	}

	async refreshAzureResources(): Promise<void> {
		if (!this._isLoading) {
			this._isLoading = true;
			try {
				this._onChange.fire();
				this._azureServers = await this.getAzureMongoResources();
			} finally {
				this._isLoading = false;
				this._onChange.fire();
			}
		}
	}

	private async getAzureMongoResources(): Promise<IMongoResource[]> {
		let servers: Server[] = [];

		await Promise.all(this.azureAccount.filters.map(async (filter) => {
			const docDBClient = new DocumentdbManagementClient(filter.session.credentials, filter.subscription.subscriptionId);
			const resourceManagementClient = new ResourceManagementClient(filter.session.credentials, filter.subscription.subscriptionId);
			const resourceGroups = await resourceManagementClient.resourceGroups.list();

			const serverResult = await Promise.all(resourceGroups.map(async group => {
				const dbs = (await docDBClient.databaseAccounts.listByResourceGroup(group.name)).filter(db => db.kind === "MongoDB");
				return Promise.all(dbs.map(async db => {
					const result = await docDBClient.databaseAccounts.listConnectionStrings(group.name, db.name);
					// Use the default connection string
					const connectionString = result.connectionStrings[0].connectionString;
					const mongoDB = await MongoClient.connect(connectionString);
					return new Server(connectionString, mongoDB.serverConfig, db, group.name);
				}));
			}));

			servers = servers.concat(...serverResult);
		}));

		return servers.sort((a, b) => {
			const n = a.resourceGroupName.localeCompare(b.resourceGroupName);
			return n !== 0 ? n : a.name.localeCompare(b.name);
		});
	}
}

export class LoadingNode implements IMongoResource {
	readonly contextValue: string = 'mongoLoading';
	readonly label: string = "Loading Azure resources...";
	readonly id: string = "mongoLoading";
}

export class AddResourceFilterNode implements IMongoResource {
	readonly contextValue: string = 'mongoAddResourceFilter';
	readonly label: string = "No Azure resources found. Edit filters...";
	readonly id: string = "mongoAddResourceFilter";
	readonly command: Command = {
		command: 'azure-account.addFilter',
		title: ''
	};
}

export class SignInToAzureNode implements IMongoResource {
	readonly contextValue: string = 'mongoSignInToAzure';
	readonly label: string = "Sign in to Azure...";
	readonly id: string = "mongoSignInToAzure";
	readonly command: Command = {
		command: 'azure-account.login',
		title: ''
	};
}