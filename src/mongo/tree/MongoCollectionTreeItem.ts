/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as vm from 'vm';
import * as path from 'path';
import * as _ from 'underscore';
import { MongoClient, Db, Collection, Cursor, ObjectID, InsertOneWriteOpResult } from 'mongodb';
import { IAzureParentTreeItem, IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { DialogBoxResponses, DefaultBatchSize } from '../../constants';
import { IMongoDocument, MongoDocumentTreeItem } from './MongoDocumentTreeItem';
import { DEFAULT_ENCODING } from 'crypto';

export class MongoCollectionTreeItem implements IAzureParentTreeItem {
	public static contextValue: string = "MongoCollection";
	public readonly contextValue: string = MongoCollectionTreeItem.contextValue;
	public readonly childTypeLabel: string = "Document";

	private readonly collection: Collection;
	private readonly _query: string | undefined;
	private readonly _databaseConnectionString: string;
	private _cursor: Cursor | undefined;
	private _hasMoreChildren: boolean = true;
	private _parentId: string;
	private _batchSize: number = DefaultBatchSize;

	constructor(databaseConnectionString: string, collection: Collection, parentId: string, query?: string) {
		this.collection = collection;
		this._parentId = parentId;
		this._query = query;
		this._databaseConnectionString = databaseConnectionString;
	}

	public async update(documents: IMongoDocument[]): Promise<IMongoDocument[]> {
		const operations = documents.map((document) => {
			return {
				updateOne: {
					filter: { _id: new ObjectID(document._id) },
					update: _.omit(document, '_id'),
					upsert: false
				}
			};
		});

		const result = await this.collection.bulkWrite(operations);
		return documents;
	}

	get id(): string {
		return `${this._parentId}/${this.collection.collectionName}`;
	}

	get label(): string {
		return this.collection.collectionName;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
		};
	}

	public hasMoreChildren(): boolean {
		return this._hasMoreChildren;
	}

	public async loadMoreChildren(_node: IAzureNode, clearCache: boolean): Promise<IAzureTreeItem[]> {
		if (clearCache || this._cursor === undefined) {
			this._cursor = this.collection.find(this._query).batchSize(DefaultBatchSize);
			this._batchSize = DefaultBatchSize;
		}

		const documents: IMongoDocument[] = [];
		let count: number = 0;
		while (count < this._batchSize) {
			this._hasMoreChildren = await this._cursor.hasNext();
			if (this._hasMoreChildren) {
				documents.push(<IMongoDocument>await this._cursor.next());
				count += 1;
			} else {
				break;
			}
		}
		this._batchSize *= 2;

		return documents.map((document: IMongoDocument) => new MongoDocumentTreeItem(document, this.collection, this.id));
	}

	public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
		let docId: string | undefined = await vscode.window.showInputBox({
			placeHolder: "Docuemnt ID",
			prompt: "Enter a unique id for the document",
			ignoreFocusOut: true
		});

		if (docId !== undefined) {
			showCreatingNode(docId);
			const result: InsertOneWriteOpResult = await this.collection.insertOne(docId === '' ? {} : { "id": docId });
			const newDocument: IMongoDocument = await this.collection.findOne({ _id: result.insertedId });
			return new MongoDocumentTreeItem(newDocument, this.collection, this.id);
		}

		throw new UserCancelledError();
	}

	executeCommand(name: string, args?: string): Thenable<string> {
		try {
			if (name === 'drop') {
				return reportProgress(this.drop(), 'Dropping collection');
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
			if (name === 'count') {
				return reportProgress(this.count(args ? parseJSContent(args) : undefined), 'Counting');
			}
			return null;
		} catch (error) {
			return Promise.resolve(error);
		}
	}

	public async deleteTreeItem(_node: IAzureNode): Promise<void> {
		const message: string = `Are you sure you want to delete collection '${this.label}'?`;
		const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
		if (result === DialogBoxResponses.Yes) {
			await this.drop();
		} else {
			throw new UserCancelledError();
		}
	}

	private async drop(): Promise<string> {
		const db: Db = await MongoClient.connect(this._databaseConnectionString);
		await db.dropCollection(this.collection.collectionName);
		return `Dropped collection ${this.collection.collectionName}.`;
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

	private async count(args?: any): Promise<string> {
		const count = await this.collection.count(args);
		return JSON.stringify(count);
	}

	private stringify(result: any): string {
		return JSON.stringify(result, null, '\t')
	}
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
