/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Command } from 'vscode';
import { INode, IDocumentNode, LoadMoreNode } from '../nodes';
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
	private _children = [];
	private _hasFetched: boolean = false;
	private _loadMoreNode: LoadMoreNode = new LoadMoreNode(this);
	private _hasMore: boolean;
	private _iterator: QueryIterator<any>;

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
		this._children = [];
		this._hasFetched = false;
	}

	async getChildren(): Promise<INode[]> {
		if (!this._hasFetched) {
			const collLink: string = this.getCollLink();
			const client = new DocumentClient(this.db.getEndpoint(), { masterKey: this.db.getPrimaryMasterKey() });
			this._iterator = await client.readDocuments(collLink);
			await this.addMoreChildren();
			this._hasFetched = true;
		}
		return this._hasMore ? this._children.concat([this._loadMoreNode]) : this._children;
	}

	async addMoreChildren(): Promise<void> {
		const getNext = async (iterator: QueryIterator<any>) => {
			return await new Promise<any>((resolve, reject) => iterator.nextItem((err, result) => err ? reject(err) : resolve(result)));
		};
		const elements = await LoadMoreNode.loadMore(this._iterator, getNext);
		const loadMoreDocuments = elements.results;
		this._hasMore = elements.hasMore;
		this._children = this._children.concat(loadMoreDocuments.map(document => new DocDBDocumentNode(document.id, this, document)));
	}

	addNewDocToCache(document: any): void {
		this._children.unshift(new DocDBDocumentNode(document.id, this, document))
	}
}

export class DocDBDocumentNode implements IDocumentNode {
	private _data: IDocDBDocumentSpec;
	constructor(readonly id: string, readonly collection: DocDBCollectionNode, payload: IDocDBDocumentSpec) {
		this._data = payload;
	}

	readonly contextValue: string = "cosmosDBDocument";

	get data(): IDocDBDocumentSpec {
		return this._data;
	}

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
		command: 'cosmosDB.openDocument',
		arguments: [this],
		title: ''
	};

	public async update(newData: any): Promise<any> {
		const masterKey = await this.collection.db.getPrimaryMasterKey();
		const endpoint = await this.collection.db.getEndpoint();
		const client = new DocumentClient(endpoint, { masterKey: masterKey });
		const _self: string = this.data._self;
		this._data = await new Promise<IDocDBDocumentSpec>((resolve, reject) => {
			client.replaceDocument(_self, newData,
				{ accessCondition: { type: 'IfMatch', condition: newData._etag } },
				(err, updated) => {
					if (err) {
						reject(new Error(err.body));
					} else {
						resolve(updated);
					}
				});
		});

		return this._data;
	}
}
