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

interface IResults {
	results: Array<any>,
	hasMore: boolean
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
	private _children = [];
	private _hasFetched: boolean = false;
	private _loadMoreNode: LoadMoreNode = null;
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
		this._children = null;
		this._hasFetched = false;
		this._loadMoreNode = null;
	}

	async getChildren(): Promise<INode[]> {
		if (!this._hasFetched) {
			const collLink: string = this.getCollLink();
			const client = new DocumentClient(this.db.getEndpoint(), { masterKey: this.db.getPrimaryMasterKey() });
			let docIterator = await client.readDocuments(collLink);
			const elements = await LoadMoreNode.loadMore(docIterator, this._batchSize);
			const documents = elements.results;
			if (elements.hasMore) {
				this._loadMoreNode = new LoadMoreNode(docIterator, this);
			}
			else {
				this._loadMoreNode = null;
			}
			this._children = this._children.concat(documents.map(document => new DocDBDocumentNode(document.id, this, document)));
			this._hasFetched = true;
		}
		return this._children.concat([this._loadMoreNode]);

	}

	async addMoreChildren(): Promise<void> {
		const elements = await LoadMoreNode.loadMore(this._loadMoreNode.iterator, this._batchSize);
		const loadMoreDocuments = elements.results;
		if (!elements.hasMore) {
			this._loadMoreNode = null;
		}
		this._children = this._children.concat(loadMoreDocuments.map(document => new DocDBDocumentNode(document.id, this, document)));
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

	static async loadMore(iterator: QueryIterator<any>, batchSize: number = 20): Promise<IResults> {
		let elements = [];
		let i: number = 0
		let hasMoreItems: boolean = false;
		let current = await new Promise<any>((resolve, reject) => iterator.nextItem((err, result) => err ? reject(err) : resolve(result)));
		while (current !== undefined && i < batchSize) {
			elements.push(current);
			i++;
			current = await new Promise<any>((resolve, reject) => iterator.nextItem((err, result) => err ? reject(err) : resolve(result)));
		}
		if (current !== undefined) {
			hasMoreItems = true;
		}
		return { results: elements, hasMore: hasMoreItems };
	}
}