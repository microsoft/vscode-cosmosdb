/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

import { MongoClient } from 'mongodb';
import { EventEmitter, Event, Command } from 'vscode';
import { MongoServerNode } from './mongo/nodes'
import { AzureAccount } from './azure-account.api';
import { ResourceManagementClient } from 'azure-arm-resource';
import DocumentdbManagementClient = require("azure-arm-documentdb");

export interface INode extends vscode.TreeItem {
	id: string
	label: string;
	getChildren?(): Thenable<INode[]>;
	onChange?: Event<void>
	contextValue?: string;
	command?: Command;
	iconPath?: { light: string, dark: string };
}

export class CosmosDBRootNode implements INode {

	readonly id: string = 'cosmosDBRoot';
	readonly label: string = 'Cosmos DB';
	readonly type: string = 'cosmosDBRoot';
	readonly canHaveChildren: boolean = true;

	private _azureResources: INode[] = [];
	private _attachedResources: INode[] = [];
	private _isLoading: boolean = false;
	
	private _onChange: EventEmitter<void> = new EventEmitter<void>();
	readonly onChange: Event<void> = this._onChange.event;

	constructor(private azureAccount: AzureAccount) {
	}

	async getChildren(): Promise<INode[]> {
		let azureResources = this._azureResources;

		if (this._isLoading || this.azureAccount.status === "Initializing" || this.azureAccount.status === "LoggingIn") {
			azureResources = [new LoadingNode()];
		} else if (this.azureAccount.status === "LoggedOut") {
			azureResources = [new SignInToAzureNode()];
		} else if (azureResources.length === 0) {
			azureResources = [new NoResourcesNode()];
		}

		return azureResources.concat(this._attachedResources);
	}

	async attach(connectionString: string) {
		try {
			const db = await MongoClient.connect(connectionString);
			const account = new MongoServerNode(connectionString, db.serverConfig);
			if (this._attachedResources.find(s => s.id === account.id)) {
				vscode.window.showWarningMessage(`Mongo account '${account.id}' is already attached.`)
			} else {
				this._attachedResources.push(account);
				this._onChange.fire();
			}
		} catch (error) {
			vscode.window.showErrorMessage(error.message);
		}
	}

	remove(server: INode) {
		const index = this._attachedResources.findIndex((value) => value.id === server.id);
		if (index !== -1) {
			this._attachedResources.splice(index, 1);
			this._onChange.fire();
		}
	}

	async refreshAzureResources(): Promise<void> {
		if (!this._isLoading) {
			this._isLoading = true;
			try {
				this._onChange.fire();
				this._azureResources = await this.getAzureMongoResources();
			} finally {
				this._isLoading = false;
				this._onChange.fire();
			}
		}
	}

	private async getAzureMongoResources(): Promise<INode[]> {
		let resources: MongoServerNode[] = [];

		await Promise.all(this.azureAccount.filters.map(async (filter) => {
			const docDBClient = new DocumentdbManagementClient(filter.session.credentials, filter.subscription.subscriptionId);
			const resourceManagementClient = new ResourceManagementClient(filter.session.credentials, filter.subscription.subscriptionId);
			const resourceGroups = await resourceManagementClient.resourceGroups.list();

			const result = await Promise.all(resourceGroups.map(async group => {
				const dbs = (await docDBClient.databaseAccounts.listByResourceGroup(group.name)).filter(db => db.kind === "MongoDB");
				return Promise.all(dbs.map(async db => {
					const result = await docDBClient.databaseAccounts.listConnectionStrings(group.name, db.name);
					// Use the default connection string
					const connectionString = result.connectionStrings[0].connectionString;
					const mongoDB = await MongoClient.connect(connectionString);
					return new MongoServerNode(connectionString, mongoDB.serverConfig, db, group.name);
				}));
			}));

			resources = resources.concat(...result);
		}));

		return resources.sort((a, b) => {
			const n = a.resourceGroupName.localeCompare(b.resourceGroupName);
			return n !== 0 ? n : a.name.localeCompare(b.name);
		});
	}
}

export class LoadingNode implements INode {
	readonly contextValue: string = 'cosmosDBLoading';
	readonly label: string = "Loading Azure resources...";
	readonly id: string = "cosmosDBLoading";
}

export class NoResourcesNode implements INode {
	readonly contextValue: string = 'cosmosDBNoResourcesNode';
	readonly label: string = "No Azure resources found. Edit filters...";
	readonly id: string = "cosmosDBNoResourcesNode";
	readonly command: Command = {
		command: 'azure-account.addFilter',
		title: ''
	};
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