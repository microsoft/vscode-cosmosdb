/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Command } from 'vscode';
import { INode } from '../nodes';
import { DocumentClient } from 'documentdb';


export interface IDocDBServer extends INode {
	getPrimaryMasterKey(): string;
	getEndpoint(): string;
}


export class DocDBDatabaseNode implements INode {
	readonly contextValue: string;
	constructor(readonly id: string, readonly _primaryMasterKey: string, readonly _endPoint: string, readonly defaultExperience: string, readonly server: INode) {
		this.contextValue = "cosmosDBDocumentDatabase"
	}

	getPrimaryMasterKey(): string {
		return this._primaryMasterKey;
	}
	getEndpoint(): string {
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
		const dbLink: string = this.getDbLink();
		const parentNode = this;
		const client = new DocumentClient(this.getEndpoint(), { masterKey: this.getPrimaryMasterKey() });
		let collections = await this.listCollections(dbLink, client);
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

	readonly contextValue: string = "cosmosDBDocumentCollection";

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

	getCollLink(): string {
		return this.db.getDbLink() + '/colls/' + this.id;
	}

	async getDocuments(): Promise<any> {
		const dbLink: string = this.db.getDbLink();
		const client = new DocumentClient(this.db.getEndpoint(), { masterKey: this.db.getPrimaryMasterKey() });
		const collSelfLink = this.getCollLink();
		const docs = await this.readOneCollection(collSelfLink, client);
		return await docs;
	}

	async readOneCollection(selfLink, client): Promise<any> {
		let documents = await client.readDocuments(selfLink, { maxItemCount: 20 });
		return await new Promise<any[]>((resolve, reject) => {
			documents.toArray((err, docs: Array<Object>) => err ? reject(err) : resolve(docs));
		});
	}

}