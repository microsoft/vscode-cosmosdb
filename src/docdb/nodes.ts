import * as vscode from 'vscode';
import * as vm from 'vm';
import * as path from 'path';
import { EventEmitter, Event, Command } from 'vscode';
import { AzureAccount } from '../azure-account.api';
import { INode, ErrorNode } from '../nodes';
import { ResourceManagementClient } from 'azure-arm-resource';
import docDBModels = require("azure-arm-documentdb/lib/models");
import DocumentdbManagementClient = require("azure-arm-documentdb");
import {MongoDatabaseNode} from '../mongo/nodes';
var DocumentDBConnectionClient = require("documentdb").DocumentClient; 

export interface DocDBCommand {
	range: vscode.Range;
	text: string;
	collection?: string;
	name: string;
	arguments?: string;
}

export interface IDocDBServer extends INode {
	getPrimaryMasterKey(): Promise<string>;
	getEndpoint(): Promise<string>;
}

export class DocDBServerNode implements IDocDBServer {
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

    getPrimaryMasterKey(): Promise<string> {
		return Promise.resolve(this._primaryMasterKey);
	}

	getEndpoint(): Promise<string>{
		return Promise.resolve(this._endpoint);
	}

    getChildren(): Promise<INode[]> {
		//return new Promise<DocDBServerNode[]>;
		let client = new DocumentDBConnectionClient(this.getEndpoint(), this.getPrimaryMasterKey());
		return this.getDocDBDatabaseNodes(client, this);
	}

	async listDatabases(client): Promise<any[]>{
		let databases = await client.readDatabases();
		let toArrayPromise = new Promise<any[]>((resolve,reject) => {
			databases.toArray(function (err , dbs: Array<Object>) {
				if (err) {
					reject(err);
				} 
				else {            
					resolve(dbs);
				}
			});
		});

		return await toArrayPromise;
	}
        
    async getDocDBDatabaseNodes(client, DocDBServerNodeInstance): Promise<INode[]> {
        let databases;
        try{
            databases = await this.listDatabases(client);
        }catch(err) {
            databases = [];
            vscode.window.showErrorMessage(err.code + ": " + JSON.parse(err.body).message);
        }
        return databases.map(database => new DocDBDatabaseNode(database.id, DocDBServerNodeInstance));
        //return new Promise<DocDBServerNode[]>;
	}
	
}

export class DocDBDatabaseNode implements INode {
	readonly contextValue: string = 'DocDb';

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
		let client = new DocumentDBConnectionClient(this.server.getEndpoint(), this.server.getPrimaryMasterKey());
        try{
            collections = await this.listCollections(dbLink, client);
        }catch(err) {
            collections = [];
            vscode.window.showErrorMessage(err.code + ": " + JSON.parse(err.body).message);
        }
        return collections.map(collection => new DocDBCollectionNode(collection.id, parentNode));
	}

	async listCollections(databaseLink, client): Promise<any> {
		let collections = await client.readCollections(databaseLink)
		let toArrayPromise = new Promise<any[]>((resolve, reject) => {
			collections.toArray(function (err, cols: Array<Object>) {
				if (err) {
					console.log("Error!" + JSON.stringify(err));
					reject(err);
				} 
				else {
					console.log("Cols: "+cols.length);
					console.log(JSON.stringify(cols));            
					resolve(cols);
				}
			});
	
		});
		return await toArrayPromise; 
	}


}


export class DocDBCollectionNode implements INode {
	
		constructor(private readonly identifier:string, readonly db: DocDBDatabaseNode) { 
		}
	
		get id(): string {
			return this.id;
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
	}	