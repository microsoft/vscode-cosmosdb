/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as _ from 'underscore';
import * as vscodeUtils from '../../utils/vscodeUtils';
import { Collection, Cursor, InsertOneWriteOpResult, BulkWriteOpResultObject, CollectionInsertManyOptions } from 'mongodb';
import { IAzureParentTreeItem, IAzureTreeItem, IAzureNode, UserCancelledError, DialogResponses } from 'vscode-azureextensionui';
import { DefaultBatchSize } from '../../constants';
import { IMongoDocument, MongoDocumentTreeItem } from './MongoDocumentTreeItem';
// tslint:disable:no-var-requires
const EJSON = require("mongodb-extended-json");

export class MongoCollectionTreeItem implements IAzureParentTreeItem {
	public static contextValue: string = "MongoCollection";
	public readonly contextValue: string = MongoCollectionTreeItem.contextValue;
	public readonly childTypeLabel: string = "Document";

	private readonly collection: Collection;
	private readonly _query: object | undefined;
	private readonly _projection: object | undefined;
	private _cursor: Cursor | undefined;
	private _hasMoreChildren: boolean = true;
	private _batchSize: number = DefaultBatchSize;

	constructor(collection: Collection, query?: string[]) {
		this.collection = collection;
		this._query = query && query.length && EJSON.parse(query[0]);
		this._projection = query && query.length > 1 && EJSON.parse(query[1]);
	}

	public async update(documents: IMongoDocument[]): Promise<IMongoDocument[]> {
		const operations = documents.map((document) => {
			return {
				updateOne: {
					filter: { _id: document._id },
					update: _.omit(document, '_id'),
					upsert: false
				}
			};
		});

		const result: BulkWriteOpResultObject = await this.collection.bulkWrite(operations);
		const output = vscodeUtils.getOutputChannel();
		output.appendLine(`Successfully updated ${result.modifiedCount} document(s), inserted ${result.insertedCount} document(s)`);
		return documents;
	}

	public get id(): string {
		return this.collection.collectionName;
	}

	public get label(): string {
		return this.collection.collectionName;
	}

	public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
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
			if (this._projection) {
				this._cursor = this._cursor.project(this._projection);
			}
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

		return documents.map((document: IMongoDocument) => new MongoDocumentTreeItem(document, this.collection));
	}

	public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
		showCreatingNode("");
		const result: InsertOneWriteOpResult = await this.collection.insertOne({});
		const newDocument: IMongoDocument = await this.collection.findOne({ _id: result.insertedId });
		return new MongoDocumentTreeItem(newDocument, this.collection);
	}

	//tslint:disable:cyclomatic-complexity
	executeCommand(name: string, args?: string[]): Thenable<string> {
		try {
			if (name === 'findOne') {
				return reportProgress(this.findOne(args ? args.map(parseJSContent) : undefined), 'Finding');
			}
			if (name === 'drop') {
				return reportProgress(this.drop(), 'Dropping collection');
			}
			if (name === 'insertMany') {
				return reportProgress(this.insertMany(args ? args.map(parseJSContent) : undefined), 'Inserting documents');
			}
			else {
				let argument;
				if (args && args.length > 1) {
					return undefined;
				}
				if (args) {
					argument = args[0];
				}
				if (name === 'insert') {
					return reportProgress(this.insert(argument ? parseJSContent(argument) : undefined), 'Inserting document');
				}
				if (name === 'insertOne') {
					return reportProgress(this.insertOne(argument ? parseJSContent(argument) : undefined), 'Inserting document');
				}
				if (name === 'deleteOne') {
					return reportProgress(this.deleteOne(argument ? parseJSContent(argument) : undefined), 'Deleting document');
				}
				if (name === 'deleteMany') {
					return reportProgress(this.deleteMany(argument ? parseJSContent(argument) : undefined), 'Deleting documents');
				}
				if (name === 'remove') {
					return reportProgress(this.remove(argument ? parseJSContent(argument) : undefined), 'Removing');
				}
				if (name === 'count') {
					return reportProgress(this.count(argument ? parseJSContent(argument) : undefined), 'Counting');
				}
				return null;
			}
		} catch (error) {
			return Promise.resolve(error);
		}
	}

	public async deleteTreeItem(_node: IAzureNode): Promise<void> {
		const message: string = `Are you sure you want to delete collection '${this.label}'?`;
		const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
		if (result === DialogResponses.deleteResponse) {
			await this.drop();
		} else {
			throw new UserCancelledError();
		}
	}

	private async drop(): Promise<string> {
		try {
			await this.collection.drop();
			return `Dropped collection '${this.collection.collectionName}'.`;
		} catch (e) {
			let error: { code?: number, name?: string } = e;
			const NamespaceNotFoundCode = 26;
			if (error.name === 'MongoError' && error.code === NamespaceNotFoundCode) {
				return `Collection '${this.collection.collectionName}' could not be dropped because it does not exist.`;
			} else {
				throw error;
			}
		}
	}

	//tslint:disable:no-any
	private async findOne(args?: any[]): Promise<string> {
		let result;
		if (!args || args.length === 0) {
			result = await this.collection.findOne({});
		} else if (args.length === 1) {
			result = await this.collection.findOne(args[0]);
		} else if (args.length === 2) {
			result = await this.collection.findOne(args[0], { fields: args[1] });
		} else {
			return Promise.reject(new Error("Too many arguments passed to findOne."));
		}
		// findOne is the only command in this file whose output requires EJSON support.
		// Hence that's the only function which uses EJSON.stringify rather than this.stringify.
		return EJSON.stringify(result, null, '\t');
	}

	private insert(document: Object): Thenable<string> {
		return this.collection.insert(document)
			.then(({ insertedCount, insertedId, result }) => {
				return this.stringify({ insertedCount, insertedId, result })
			});
	}

	private insertOne(document: Object): Thenable<string> {
		return this.collection.insertOne(document)
			.then(({ insertedCount, insertedId, result }) => {
				return this.stringify({ insertedCount, insertedId, result })
			});
	}

	//tslint:disable:no-any
	private insertMany(args: any[]): Thenable<string> {
		// documents = args[0], collectionWriteOptions from args[1]
		let insertManyOptions: CollectionInsertManyOptions = {};
		const docsLink: string = "Please see mongo shell documentation. https://docs.mongodb.com/manual/reference/method/db.collection.insertMany/#db.collection.insertMany.";
		if (!args || args.length === 0) {
			return Promise.reject(new Error("Too few arguments passed to insertMany. " + docsLink));
		}
		if (args.length > 2) {
			return Promise.reject(new Error("Too many arguments passed to insertMany. " + docsLink));
		} else if (args.length === 2) {
			if (args[1] && args[1].ordered) {
				insertManyOptions["ordered"] = args[1].ordered;
			}
			if (args[1] && args[1].writeConcern) {
				insertManyOptions["w"] = args[1].writeConcern;
			}
		}

		return this.collection.insertMany(args[0], insertManyOptions)
			.then(({ insertedCount, insertedIds, result }) => {
				return this.stringify({ insertedCount, insertedIds, result })
			});
	}

	private remove(args?: Object): Thenable<string> {
		return this.collection.remove(args)
			.then(({ ops, result }) => {
				return this.stringify({ ops, result })
			});
	}

	private deleteOne(args?: Object): Thenable<string> {
		return this.collection.deleteOne(args)
			.then(({ deletedCount, result }) => {
				return this.stringify({ deletedCount, result })
			});
	}

	private deleteMany(args?: Object): Thenable<string> {
		return this.collection.deleteMany(args)
			.then(({ deletedCount, result }) => {
				return this.stringify({ deletedCount, result })
			});
	}

	private async count(args?: Object): Promise<string> {
		const count = await this.collection.count(args);
		return JSON.stringify(count);
	}

	// tslint:disable-next-line:no-any
	private stringify(result: any): string {
		return JSON.stringify(result, null, '\t')
	}
}

function reportProgress<T>(promise: Thenable<T>, title: string): Thenable<T> {
	return vscode.window.withProgress<T>(
		{
			location: vscode.ProgressLocation.Window,
			title
		},
		(_progress) => {
			return promise;
		})
}

// tslint:disable-next-line:no-any
function parseJSContent(content: string): any {
	try {
		return EJSON.parse(content);
	} catch (error) {
		throw error.message;
	}
}
