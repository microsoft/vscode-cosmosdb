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
import {MongoCommands} from '../mongo/commands'
var DocumentDBConnectionClient = require("documentdb").DocumentClient;


export interface DocDBCommand {
	range: vscode.Range;
	text: string;
	collection?: string;
	name: string;
	arguments?: string;
}

export interface IDocDBServer extends INode {
	getPrimaryMasterKey(): string;
	getEndpoint(): string;
}

export class DocDBServerNode implements IDocDBServer {
	readonly contextValue: string = "DocDBServer";
	readonly label: string;

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	constructor(readonly _primaryMasterKey: string, readonly id: string, private readonly _endpoint: string) {
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

	getChildren(): Promise<INode[]> {
		//return new Promise<DocDBServerNode[]>;
		let client = new DocumentDBConnectionClient(this.getEndpoint(), this.getPrimaryMasterKey());
		return this.getDocDBDatabaseNodes(client, this);
	}

	async listDatabases(client): Promise<any[]> {
		let databases = await client.readDatabases();
		return await new Promise<any[]>((resolve, reject) => {
			databases.toArray( (err, dbs: Array<Object>) => err ? reject(err) : resolve(dbs) );
		});
	}

	async getDocDBDatabaseNodes(client, DocDBServerNodeInstance): Promise<INode[]> {
		let databases;
		try {
			databases = await this.listDatabases(client);
		} catch (err) {
			databases = [];
			vscode.window.showErrorMessage(err.code + ": " + JSON.parse(err.body).message);
		}
		return databases.map(database => new DocDBDatabaseNode(database.id, DocDBServerNodeInstance));
	}

}

export class DocDBDatabaseNode implements INode {
	readonly contextValue: string = 'DocDbDatabase';

	constructor(readonly id: string, readonly server: IDocDBServer) {
	}

	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'light', 'Database.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'dark', 'Database.svg')
		};
	}

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	getDbLink(): string {
		return 'dbs/' + this.id;
	}

	getChildren(): Promise<INode[]> {
		return this.getCollections();
	}

	async getCollections(): Promise<INode[]> {
		let dbLink: string = this.getDbLink();
		let collections;
		let parentNode = this;
		let client = new DocumentDBConnectionClient(this.server.getEndpoint(), {masterKey: this.server.getPrimaryMasterKey() });
		try {
			collections = await this.listCollections(dbLink, client);
		} catch (err) {
			collections = [];
			vscode.window.showErrorMessage(err.code + ": " + JSON.parse(err.body).message);
		}

		return collections.map(collection => new DocDBCollectionNode(collection.id, parentNode));
	}

	async listCollections(databaseLink, client): Promise<any> {
		let collections = await client.readCollections(databaseLink);
		return await new Promise<any[]>((resolve, reject) => {
			collections.toArray( (err, cols: Array<Object>) => err ? reject(err) : resolve(cols) );
		});
	}

}


export class DocDBCollectionNode implements INode {

	constructor(readonly id: string, readonly db: DocDBDatabaseNode) {
	}

	readonly contextValue: string = 'DocDbCollection';
	readonly DocGenerationJSONReplacer = function replacer(key, value) {
		let redundantProperties: Array<string> = ["_rid", "_ts", "_self", "_etag", "_attachments"]; 
		if(redundantProperties.indexOf(key) > -1){
			return undefined;
		}
		return value;
	}

	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'light', 'Collection.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'dark', 'Collection.svg'),
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
		let client = new DocumentDBConnectionClient(this.db.server.getEndpoint(), {masterKey: this.db.server.getPrimaryMasterKey() });
		let docs;
		try{
			let collSelfLink = dbLink + "/colls/" + this.id;
			let docs = await this.readOneCollection(collSelfLink, client);
			console.log(docs);
			return await docs; 
		} catch (error){
			console.log(error.message);
			return;
		}
	}

	async readOneCollection(selfLink, client): Promise<any>{
		let documents = await client.readDocuments(selfLink);
		return await new Promise<any[]>((resolve, reject) => {
			documents.toArray((err, docs: Array<Object>) => err ? reject(err) : resolve(docs));
		});
	}

}