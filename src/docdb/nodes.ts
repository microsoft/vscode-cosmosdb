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

export interface IDocDBDocumentSpec {
	_self: string;
	_rid?: string;
}

export class DocDBDatabaseNode implements INode {
	readonly contextValue: string = "cosmosDBDocumentDatabase";

	constructor(readonly id: string, readonly _primaryMasterKey: string, readonly _endPoint: string, readonly server: INode) {
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
		return "DocDBCollectionNode" + this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - DocDB collections LARGE.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - DocDB collections LARGE.svg'),
		};
	}
	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

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

	async getChildren(): Promise<INode[]> {
		const collLink: string = this.getCollLink();
		const parentNode = this;
		const client = new DocumentClient(this.db.getEndpoint(), { masterKey: this.db.getPrimaryMasterKey() });
		let documents = await this.listDocuments(collLink, client);
		return documents.map(document => new DocDBDocumentNode(document.id, parentNode, document));
	}

	async listDocuments(collSelfLink, client): Promise<any> {
		let documents = await client.readDocuments(collSelfLink);
		return await new Promise<any[]>((resolve, reject) => {
			documents.toArray((err, cols: Array<Object>) => err ? reject(err) : resolve(cols));
		});
	}

	async readOneCollection(selfLink, client): Promise<any> {
		let documents = await client.readDocuments(selfLink, { maxItemCount: 20 });
		return await new Promise<any[]>((resolve, reject) => {
			documents.toArray((err, docs: Array<Object>) => err ? reject(err) : resolve(docs));
		});
	}

}

export class DocDBDocumentNode implements INode {
	data: IDocDBDocumentSpec;
	constructor(readonly id: string, readonly collection: DocDBCollectionNode, payload: IDocDBDocumentSpec) {
		this.data = payload;
	}

	readonly contextValue: string = "cosmosDBDocument";

	get label(): string {
		return "DocDBDocumentNode" + this.id;
	}

	getDocLink(): string {
		return this.collection.getCollLink() + '/docs/' + this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - document 2 LARGE.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Azure DocumentDB - document 2 LARGE.svg'),
		};
	}
	readonly collapsibleState = vscode.TreeItemCollapsibleState.None;

	readonly command: Command = {
		command: 'cosmosDB.openDocDBDocument',
		arguments: [this],
		title: ''
	};
}