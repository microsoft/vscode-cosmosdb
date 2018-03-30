/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as vm from 'vm';
import * as path from 'path';
import * as _ from 'underscore';
import * as util from '../../utils/vscodeUtils';
import { Collection, Cursor, ObjectID, InsertOneWriteOpResult, BulkWriteOpResultObject } from 'mongodb';
import { IAzureParentTreeItem, IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { DialogBoxResponses, DefaultBatchSize } from '../../constants';
import { IMongoDocument, MongoDocumentTreeItem } from './MongoDocumentTreeItem';

export class MongoCollectionTreeItem implements IAzureParentTreeItem {
	public static contextValue: string = "MongoCollection";
	public readonly contextValue: string = MongoCollectionTreeItem.contextValue;
	public readonly childTypeLabel: string = "Document";

	private readonly collection: Collection;
	private readonly _query: object | undefined;
	private _cursor: Cursor | undefined;
	private _hasMoreChildren: boolean = true;
	private _batchSize: number = DefaultBatchSize;

	constructor(collection: Collection, query?: string[]) {
		this.collection = collection;
		this._query = query && query.length > 0 ? JSON.parse(query[0]) : undefined;
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

		const result: BulkWriteOpResultObject = await this.collection.bulkWrite(operations);
		const output = util.getOutputChannel();
		output.appendLine(`Successfully updated ${result.modifiedCount} document(s), inserted ${result.insertedCount} document(s)`);
		return documents;
	}

	get id(): string {
		return this.collection.collectionName;
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

		return documents.map((document: IMongoDocument) => new MongoDocumentTreeItem(document, this.collection));
	}

	public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
		let docId: string | undefined = await vscode.window.showInputBox({
			placeHolder: "Document ID",
			prompt: "Enter a unique document ID or leave blank for a generated ID",
			ignoreFocusOut: true
		});

		if (docId !== undefined) {
			showCreatingNode(docId);
			const result: InsertOneWriteOpResult = await this.collection.insertOne(docId === '' ? {} : { "id": docId });
			const newDocument: IMongoDocument = await this.collection.findOne({ _id: result.insertedId });
			return new MongoDocumentTreeItem(newDocument, this.collection);
		}

		throw new UserCancelledError();
	}

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
				if (args) {
					argument = argument[0];
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
		const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
		if (result === DialogBoxResponses.Yes) {
			await this.drop();
		} else {
			throw new UserCancelledError();
		}
	}

	private async drop(): Promise<string> {
		await this.collection.drop();
		return `Dropped collection ${this.collection.collectionName}.`;
	}

	private async findOne(args?: any): Promise<string> {
		if (args && args.length > 2) {
			throw new Error("Too many arguments")
		}
		let result;
		if (args.length === 1) {
			result = await this.collection.findOne(args[0]);
		} else if (args.length === 2) {
			result = await this.collection.findOne(args[0], { fields: args[1] });
		} else {
			result = await this.collection.findOne({});
		}
		return this.stringify(result);
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

	private insertMany(args: any[]): Thenable<string> {
		// documents = args[0], collectionWriteOptions from args[1]
		let collectionWriteOptions = {};
		if (args.length > 2) {
			throw new Error("Too many arguments. Please see mongo shell documentation. https://docs.mongodb.com/manual/reference/method/db.collection.insertMany/#db.collection.insertMany");
		} else if (args.length === 2) {
			if (args[1] && args[1].ordered) {
				collectionWriteOptions["ordered"] = args[1].ordered;
			}
			if (args[1] && args[1].writeConcern) {
				collectionWriteOptions["writeConcern"] = args[1].writeConcern;
			}
		}

		return this.collection.insertMany(args[0], collectionWriteOptions)
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
	return vscode.window.withProgress<T>(
		{
			location: vscode.ProgressLocation.Window,
			title
		},
		(progress) => {
			return promise;
		})
}

function parseJSContent(content: string): any {
	try {
		const sandbox = {};
		// tslint:disable-next-line:insecure-random
		const key = 'parse' + Math.floor(Math.random() * 1000000);
		sandbox[key] = {};
		vm.runInNewContext(key + '=' + content, sandbox);
		return sandbox[key];
	} catch (error) {
		throw error.message;
	}
}
