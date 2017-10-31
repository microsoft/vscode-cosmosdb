/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Command } from 'vscode';
import { INode } from '../nodes';
import { DocumentClient, QueryIterator } from 'documentdb';


export interface IDocDBServer extends INode {
	getPrimaryMasterKey(): string;
	getEndpoint(): string;
}

export interface IDocDBDocumentSpec {
	_self: string;
	_rid?: string;
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
	private children = null;
	private _batchSize: number = 20;

	get label(): string {
		return this.id;
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

	clearCache(): void {
		this.children = null;
	}

	async getDocuments(): Promise<any> {
		const dbLink: string = this.db.getDbLink();
		const client = new DocumentClient(this.db.getEndpoint(), { masterKey: this.db.getPrimaryMasterKey() });
		const collSelfLink = this.getCollLink();
		const docs = await this.readOneCollection(collSelfLink, client);
		return await docs;
	}

	async getChildren(): Promise<INode[]> {
		if (!this.children) {
			const collLink: string = this.getCollLink();
			const client = new DocumentClient(this.db.getEndpoint(), { masterKey: this.db.getPrimaryMasterKey() });
			let docIterator = await client.readDocuments(collLink);
			let documents = await LoadMoreNode.loadNextKElements(docIterator, this._batchSize);
			this.addChildrenFromDocuments(documents);
		}
		return this.children ? this.children : [];

	}

	addChildrenFromDocuments(documents): void {
		let loadMoreHandle = null;
		if (!documents.slice(-1)[0].hasOwnProperty("_rid")) {
			loadMoreHandle = documents.pop();
		}
		const newDocuments = documents.map(document => new DocDBDocumentNode(document.id, this, document));
		if (this.children) {
			this.children = this.children.concat(newDocuments);
		}
		else {
			this.children = newDocuments;
		}
		if (loadMoreHandle) {
			this.children.push(new LoadMoreNode(loadMoreHandle, this));
		}
	}

	async addMoreChildren(): Promise<void> {
		const loadMoreNode: LoadMoreNode = this.children.pop();
		let loadMoreDocuments = await LoadMoreNode.loadNextKElements(loadMoreNode.iterator, this._batchSize);
		this.addChildrenFromDocuments(loadMoreDocuments);
	}

}

export class DocDBDocumentNode implements INode {
	data: IDocDBDocumentSpec;
	constructor(readonly id: string, readonly collection: DocDBCollectionNode, payload: IDocDBDocumentSpec) {
		this.data = payload;
	}

	readonly contextValue: string = "cosmosDBDocument";

	get label(): string {
		return this.id;
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

export class LoadMoreNode implements INode {
	constructor(readonly iterator: QueryIterator<any>, readonly parentNode: DocDBCollectionNode) {
	}

	readonly id = `${this.parentNode.id}.LoadMore`;

	readonly label = `Load More...`;

	readonly contextValue = 'LoadMoreButton'

	readonly command: Command = {
		command: 'cosmosDB.loadMore',
		arguments: [this],
		title: ''
	};

	static async loadNextKElements(iterator: QueryIterator<any>, k: number): Promise<any> {
		let elements = [], i: number = 0, hasMoreItems: boolean = false;
		let current = await new Promise<any>((resolve, reject) => iterator.nextItem((err, result) => err ? reject(err) : resolve(result)));
		while (current !== undefined && i < k) {
			elements.push(current);
			i++;
			current = await new Promise<any>((resolve, reject) => iterator.nextItem((err, result) => err ? reject(err) : resolve(result)));
		}
		if (current !== undefined) {
			hasMoreItems = true;
			elements.push(iterator);
		}
		return elements;
	}
}