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

export interface DocDBCommand {
	range: vscode.Range;
	text: string;
	collection?: string;
	name: string;
	arguments?: string;
}

export interface IDocDBServer extends INode {
	getPrimaryMasterKey(): Promise<string>;
}

export class DocDBServerNode implements IDocDBServer {
	readonly contextValue: string = "DocDBServer";
	readonly label: string;

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	constructor(private readonly _primaryMasterKey: string, readonly id: string) {
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

    getChildren(): Promise<INode[]> {
		return new Promise<DocDBServerNode[]>;
		//return DocDBServerNode.getDocDBDatabaseNodes(this._primaryMasterKey, this);
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
        
    async getDocDBDatabaseNodes(client, thisArg): Promise<INode[]> {
        let databases;
        try{
            databases = await this.listDatabases(client);
        }catch(err) {
            databases = [];
            vscode.window.showErrorMessage(err.code + ": " + JSON.parse(err.body).message);
        }
        return databases.map(database => new MongoDatabaseNode(database.id, <string>thisArg._databaseAccount.name));
        //return new Promise<DocDBServerNode[]>;
    }


}