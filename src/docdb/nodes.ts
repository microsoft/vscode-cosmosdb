/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as vm from 'vm';
import * as path from 'path';
import { EventEmitter, Event, Command } from 'vscode';
import { AzureAccount } from '../azure-account.api';
import { INode, ErrorNode } from '../nodes';
import { ResourceManagementClient } from 'azure-arm-resource';
import docDBModels = require("azure-arm-documentdb/lib/models");
import DocumentdbManagementClient = require("azure-arm-documentdb");
import { MongoDatabaseNode } from '../mongo/nodes';
import { MongoCommands } from '../mongo/commands'
import { DocumentClient } from 'documentdb';


export interface IDocDBServer extends INode {
	getPrimaryMasterKey(): string;
	getConnectionEndpoint(): string;
}

export class DocDBServerNode implements INode {
	readonly contextValue: string = "DocDBServer";
	readonly label: string;

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	constructor(private readonly _primaryMasterKey: string, readonly id: string, private readonly _endpoint: string) {
		this.label = id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'light', 'DataServer.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'dark', 'DataServer.svg')
		};
	}

	getPrimaryMasterKey(): string {
		return this._primaryMasterKey;
	}

	getEndpoint(): string {
		return this._endpoint;
	}

	async getChildren(): Promise<INode[]> {
		let client = new DocumentClient(this.getEndpoint(), { masterKey: this.getPrimaryMasterKey() });
		return await DocDBServerNode.getDocDBDatabaseNodes(client, this.getPrimaryMasterKey(), this.getEndpoint());
	}

	static async getDocDBDatabaseNodes(client: DocumentClient, masterKey: string, endpoint: string): Promise<INode[]> {
		let databases = await DocDBServerNode.listDatabases(client);
		return databases.map(database => new DocDBDatabaseNode(database.id, masterKey, endpoint));
	}

	static async listDatabases(client): Promise<any[]> {
		let databases = await client.readDatabases();
		return await new Promise<any[]>((resolve, reject) => {
			databases.toArray((err, dbs: Array<Object>) => err ? reject(err) : resolve(dbs));
		});
	}

}

export class DocDBDatabaseNode implements INode {
	readonly contextValue: string = 'DocDbDatabase';

	constructor(readonly id: string, readonly _primaryMasterKey: string, readonly _endPoint: string) {
	}

	getPrimaryMasterKey(): string {
		return this._primaryMasterKey;
	}
	getConnectionEndpoint(): string {
		return this._endPoint;
	}


	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - database LARGE.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - database LARGE.svg')
		};
	}

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	getDbLink(): string {
		return 'dbs/' + this.id;
	}

	async getChildren(): Promise<INode[]> {
		let dbLink: string = this.getDbLink();
		let collections;
		let parentNode = this;
		let client = new DocumentClient(this.getConnectionEndpoint(), { masterKey: this.getPrimaryMasterKey() });
		collections = await this.listCollections(dbLink, client);
		return collections.map(collection => new DocDBCollectionNode(collection.id, parentNode));
	}

	async listCollections(databaseLink, client): Promise<any> {
		let collections = await client.readCollections(databaseLink);
		return await new Promise<any[]>((resolve, reject) => {
			collections.toArray((err, cols: Array<Object>) => err ? reject(err) : resolve(cols));
		});
	}

}


export class DocDBCollectionNode implements INode {

	constructor(readonly id: string, readonly db: DocDBDatabaseNode) {
	}

	readonly contextValue: string = 'DocDbCollection';

	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - DocDB collections LARGE.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - DocDB collections LARGE.svg'),
		};
	}
	readonly collapsibleState = vscode.TreeItemCollapsibleState.None;

	readonly command: Command = {
		command: 'cosmosDB.openDocDBCollection',
		arguments: [this],
		title: ''
	};


	async getDocuments(): Promise<any> {
		let dbLink: string = this.db.getDbLink();
		let client = new DocumentClient(this.db.getConnectionEndpoint(), { masterKey: this.db.getPrimaryMasterKey() });
		let collSelfLink = dbLink + "/colls/" + this.id;
		let docs = await this.readOneCollection(collSelfLink, client);
		return await docs;
	}

	async readOneCollection(selfLink, client): Promise<any> {
		let documents = await client.readDocuments(selfLink, { maxItemCount: 20 });
		return await new Promise<any[]>((resolve, reject) => {
			documents.toArray((err, docs: Array<Object>) => err ? reject(err) : resolve(docs));
		});
	}

}