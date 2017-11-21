/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as vm from 'vm';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'underscore';

import { MongoClient, Db, ReadPreference, Code, Server, Collection, Cursor, ObjectID, MongoError } from 'mongodb';
import { Shell } from './shell';
import { EventEmitter, Event, Command } from 'vscode';
import { AzureAccount } from '../azure-account.api';
import { INode, ErrorNode, IEditableNode, LoadMoreNode } from '../nodes';
import { MongoCommands } from './commands';
import { ResourceManagementClient } from 'azure-arm-resource';
import docDBModels = require("azure-arm-documentdb/lib/models");
import DocumentdbManagementClient = require("azure-arm-documentdb");

export interface MongoCommand {
	range: vscode.Range;
	text: string;
	collection?: string;
	name: string;
	arguments?: string;
}

export interface IMongoServer extends INode {
	getConnectionString(): Promise<string>;
}

export class MongoServerNode implements IMongoServer {
	readonly contextValue: string = "mongoServer";
	readonly label: string;

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	constructor(private readonly _connectionString: string, readonly id: string) {
		this.label = id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'DatabaseAccount.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'DatabaseAccount.svg')
		};
	}

	getConnectionString(): Promise<string> {
		return Promise.resolve(this._connectionString);
	}

	getChildren(): Promise<INode[]> {
		return MongoServerNode.getMongoDatabaseNodes(this._connectionString, this);
	}

	static async getMongoDatabaseNodes(connectionString: string, parentNode: IMongoServer): Promise<INode[]> {
		let db: Db;
		try {
			db = await MongoClient.connect(connectionString);
			const value: { databases: { name }[] } = await db.admin().listDatabases();
			return value.databases.map(database => new MongoDatabaseNode(database.name, parentNode));
		} catch (error) {
			return [new ErrorNode(error.message)];
		} finally {
			if (db) {
				db.close();
			}
		}
	}
}

export class MongoDatabaseNode implements INode {
	readonly contextValue: string = 'mongoDb';

	constructor(readonly id: string, readonly server: IMongoServer) {
	}

	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Database.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Database.svg')
		};
	}

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	getChildren(): Promise<INode[]> {
		return <Promise<INode[]>>this.getDb().then(db => {
			return db.collections().then(collections => {
				return collections.map(collection => new MongoCollectionNode(collection, this, [], undefined));
			})
		});
	}

	async getDb(): Promise<Db> {
		const serverConnectionString = await this.server.getConnectionString();
		const uri = vscode.Uri.parse(serverConnectionString);
		const connectionString = `${uri.scheme}://${uri.authority}/${this.id}?${uri.query}`
		return <Promise<Db>>MongoClient.connect(connectionString)
			.then(db => {
				return db.db(this.id)
			});
	}

	executeCommand(command: MongoCommand): Thenable<string> {
		if (command.collection) {
			return this.getDb()
				.then(db => {
					const collection = db.collection(command.collection);
					if (collection) {
						const result = new MongoCollectionNode(collection, this, [], command.arguments).executeCommand(command.name, command.arguments);
						if (result) {
							return result;
						}
					}
					return reportProgress(this.executeCommandInShell(command), 'Executing command');
				});
		}

		if (command.name === 'createCollection') {
			return reportProgress(this.createCollection(stripQuotes(command.arguments)).then(() => JSON.stringify({ 'Created': 'Ok' })), 'Creating collection');
		} else {
			return reportProgress(this.executeCommandInShell(command), 'Executing command');
		}
	}

	async createCollection(collectionName: string): Promise<MongoCollectionNode> {
		const db: Db = await this.getDb();
		const newCollection: Collection = db.collection(collectionName);
		// db.createCollection() doesn't create empty collections for some reason
		// However, we can 'insert' and then 'delete' a document, which has the side-effect of creating an empty collection
		const result = await newCollection.insertOne({});
		await newCollection.deleteOne({ _id: result.insertedId });
		return new MongoCollectionNode(newCollection, this, [], undefined);
	}

	async drop() {
		const db = await this.getDb();
		await db.dropDatabase();
	}

	dropCollection(collectionName: string): Thenable<string> {
		return this.getDb().then(db => {
			return db.dropCollection(collectionName)
				.then(result => {
					return JSON.stringify({ 'dropped': result });
				});
		});
	}

	private getCollection(collection: string): Promise<MongoCollectionNode> {
		return this.getDb().then(db => new MongoCollectionNode(db.collection(collection), this, [], undefined));
	}

	executeCommandInShell(command: MongoCommand): Thenable<string> {
		return this.getShell().then(shell => shell.exec(command.text));
	}

	private getShell(): Promise<Shell> {
		const shellPath = <string>vscode.workspace.getConfiguration().get('mongo.shell.path')
		if (!shellPath) {
			return <Promise<null>>vscode.window.showInputBox({
				placeHolder: "Configure the path to mongo shell executable",
				ignoreFocusOut: true
			}).then(value => vscode.workspace.getConfiguration().update('mongo.shell.path', value, true)
				.then(() => this.createShell(value)));
		} else {
			return this.createShell(shellPath);
		}
	}

	private async createShell(shellPath: string): Promise<Shell> {
		const connectionString = await this.server.getConnectionString();
		return <Promise<null>>Shell.create(shellPath, connectionString)
			.then(shell => {
				return shell.useDatabase(this.id).then(() => shell);
			}, error => vscode.window.showErrorMessage(error));
	}
}

export class MongoCollectionNode implements IEditableNode {

	constructor(readonly collection: Collection, readonly db: MongoDatabaseNode, data: Array<any>, readonly query: string) {
		data.forEach(element => {
			this._children.push(new MongoDocumentNode(element._id, this, element));
		});
	}

	readonly contextValue: string = "MongoCollection";
	private _children = [];
	private _hasFetched: boolean = false;
	private _loadMoreNode: LoadMoreNode = new LoadMoreNode(this);
	private _hasMore: boolean;
	private _iterator: Cursor;

	get data(): Array<any> {
		return this._children.map(child => child.data);
	}
	async update(data: any): Promise<any> {
		const operations = this.getBulkWriteUpdateOperations(data);
		const result = await this.collection.bulkWrite(operations);
		await data.forEach(doc => {
			const relevantChild: MongoDocumentNode = this.findDocById(doc._id);
			if (relevantChild) {
				relevantChild.data = doc;
			}
		});
		return data;
	}

	getBulkWriteUpdateOperations(data: any): any {
		let operationsArray: Array<any> = [];
		for (let document of data) {
			const operation: object = {
				updateOne:
					{
						"filter": { _id: new ObjectID(document._id) },
						"update": _.omit(document, '_id'),
						"upsert": false
					}
			};
			operationsArray.push(operation);
		}
		return operationsArray;
	}

	findDocById(id: string): MongoDocumentNode {
		let currentDoc;
		for (currentDoc of this._children) {
			console.log(currentDoc.id);
			if (currentDoc.id.toString() === id) {
				return currentDoc;
			}
		}
		return;
	}

	get id(): string {
		return this.collection.collectionName;
	}

	get label(): string {
		return this.collection.collectionName;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
		};
	}

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	clearCache(): void {
		this._children = [];
		this._hasFetched = false;
	}

	async getChildren(): Promise<INode[]> {
		if (!this._hasFetched) {
			this._children = [];
			this._iterator = this.collection.find(this.query);
			await this.addMoreChildren();
			this._hasFetched = true
		}
		return this._hasMore ? this._children.concat([this._loadMoreNode]) : this._children;
	}

	async addMoreChildren(): Promise<void> {
		const getNext = async (iterator: Cursor) => {
			return await iterator.next();
		};
		const elements = await LoadMoreNode.loadMore(this._iterator, getNext);
		const loadMoreDocuments = elements.results;
		this._hasMore = elements.hasMore;
		this._children = this._children.concat(loadMoreDocuments.map(document => new MongoDocumentNode(document._id, this, document)));
	}

	addNewDocToCache(document: any): void {
		this._children.unshift(new MongoDocumentNode(document._id, this, document))
	}

	removeNodeFromCache(documentNode: MongoDocumentNode): void {
		this._children = this._children.filter(doc => doc.id !== documentNode.id);
	}

	getSelfLink() {
		return `${this.db.server.id}.${this.db.id}.${this.id}`
	}

	executeCommand(name: string, args?: string): Thenable<string> {
		try {
			if (name === 'find') {
				return reportProgress(this.find(args ? parseJSContent(args) : undefined), 'Running find query');
			}
			if (name === 'drop') {
				return reportProgress(this.drop(), 'Dropping collection');
			}
			if (name === 'findOne') {
				return reportProgress(this.findOne(args ? parseJSContent(args) : undefined), 'Running find query');
			}
			if (name === 'insertMany') {
				return reportProgress(this.insertMany(args ? parseJSContent(args) : undefined), 'Inserting documents');
			}
			if (name === 'insert') {
				return reportProgress(this.insert(args ? parseJSContent(args) : undefined), 'Inserting document');
			}
			if (name === 'insertOne') {
				return reportProgress(this.insertOne(args ? parseJSContent(args) : undefined), 'Inserting document');
			}
			if (name === 'deleteOne') {
				return reportProgress(this.deleteOne(args ? parseJSContent(args) : undefined), 'Deleting document');
			}
			if (name === 'deleteMany') {
				return reportProgress(this.deleteMany(args ? parseJSContent(args) : undefined), 'Deleting documents');
			}
			if (name === 'remove') {
				return reportProgress(this.remove(args ? parseJSContent(args) : undefined), 'Removing');
			}
			return null;
		} catch (error) {
			return Promise.resolve(error);
		}
	}

	private drop(): Thenable<string> {
		return this.db.dropCollection(this.collection.collectionName);
	}

	private find(args?: any): Thenable<string> {
		let maxDocs: number = 0;
		try {
			maxDocs = vscode.workspace.getConfiguration().get<number>('cosmosDB.mongo.maxDocs');
		}
		catch (error) {
		}
		finally {
			maxDocs = maxDocs > 0 ? maxDocs : 20;
		}
		return this.collection.find(args).limit(maxDocs)
			.toArray().then(docs => this.stringify(docs));
	}

	private findOne(args?: any): Thenable<string> {
		return this.collection.findOne(args)
			.then(result => this.stringify(result));
	}

	private insert(document: any): Thenable<string> {
		return this.collection.insert(document)
			.then(({ insertedCount, insertedId, result }) => {
				return this.stringify({ insertedCount, insertedId, result })
			});
	}

	private insertOne(document: any): Thenable<string> {
		return this.collection.insertOne(document)
			.then(({ insertedCount, insertedId, result }) => {
				return this.stringify({ insertedCount, insertedId, result })
			});
	}

	private insertMany(documents: any[]): Thenable<string> {
		return this.collection.insertMany(documents)
			.then(({ insertedCount, insertedIds, result }) => {
				return this.stringify({ insertedCount, insertedIds, result })
			});
	}

	private remove(args?: any): Thenable<string> {
		return this.collection.remove(args)
			.then(({ ops, result }) => {
				return this.stringify({ ops, result })
			});
	}

	private deleteOne(args?: any): Thenable<string> {
		return this.collection.deleteOne(args)
			.then(({ deletedCount, result }) => {
				return this.stringify({ deletedCount, result })
			});
	}

	private deleteMany(args?: any): Thenable<string> {
		return this.collection.deleteMany(args)
			.then(({ deletedCount, result }) => {
				return this.stringify({ deletedCount, result })
			});
	}

	private stringify(result: any): string {
		return JSON.stringify(result, null, '\t')
	}
}

export class MongoDocumentNode implements IEditableNode {
	private _data: object;
	constructor(readonly id: string, readonly collection: MongoCollectionNode, payload: Object) {
		this._data = payload;
	}

	readonly contextValue: string = "MongoDocument";

	get data(): object {
		return this._data;
	}

	set data(datum: object) {
		this._data = datum;
	}

	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Document.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Document.svg'),
		};
	}

	public async update(data: any): Promise<any> {
		const filter: object = { _id: new ObjectID(data._id) };
		await this.collection.collection.updateOne(filter, _.omit(data, '_id'));
		this._data = data;
		return this._data;
	}

	getSelfLink() {
		return `${this.collection.db.server.id}.${this.collection.db.id}.${this.collection.id}.${this.id}`
	}

	readonly collapsibleState = vscode.TreeItemCollapsibleState.None;

	readonly command: Command = {
		command: 'cosmosDB.openDocument',
		arguments: [this],
		title: ''
	};
}

function reportProgress<T>(promise: Thenable<T>, title: string): Thenable<T> {
	return vscode.window.withProgress<T>({
		location: vscode.ProgressLocation.Window,
		title
	}, (progress) => {
		return promise;
	})
}

function parseJSContent(content: string): any {
	try {
		const sandbox = {};
		const key = 'parse' + Math.floor(Math.random() * 1000000);
		sandbox[key] = {};
		vm.runInNewContext(key + '=' + content, sandbox);
		return sandbox[key];
	} catch (error) {
		throw error.message;
	}
}

function stripQuotes(term: string): string {
	if ((term.startsWith('\'') && term.endsWith('\''))
		|| (term.startsWith('"') && term.endsWith('"'))) {
		return term.substring(1, term.length - 1);
	}
	return term;
}
