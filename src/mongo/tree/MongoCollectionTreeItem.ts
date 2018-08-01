/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BulkWriteOpResultObject, Collection, CollectionInsertManyOptions, Cursor, InsertOneWriteOpResult, MongoCountPreferences } from 'mongodb';
import * as path from 'path';
import * as _ from 'underscore';
import * as vscode from 'vscode';
import { DialogResponses, IAzureNode, IAzureParentTreeItem, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { DefaultBatchSize } from '../../constants';
import { ext } from '../../extensionVariables';
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
	private readonly deferToShell = null;

	constructor(collection: Collection, query?: string[]) {
		this.collection = collection;
		if (query && query.length) {
			this._query = EJSON.parse(query[0]);
			this._projection = query.length > 1 && EJSON.parse(query[1]);
		}
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
		ext.outputChannel.appendLine(`Successfully updated ${result.modifiedCount} document(s), inserted ${result.insertedCount} document(s)`);
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
			dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg')
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

	executeCommand(name: string, args?: string[]): Thenable<string> | null {
		//const requiresOneArg = ['findOne', 'insertMany', 'insertOne', 'insert', 'deleteOne', 'deleteMany', 'remove'];
		const parameters = args ? args.map(parseJSContent) : undefined;
		try {
			// tslint:disable-next-line:no-any
			type MongoFunction = (...args: any[]) => Thenable<string>;
			let functions: { [functionName: string]: [MongoFunction, string, number, number, number] } = {
				// format: command name (from the argument) : corresponding function call[0],
				// text to show during the operation[1], min #args[2], #max args[3], #args this function handles[4]
				"drop": [this.drop, 'Dropping collection', 0, 0, 0],
				"insert": [this.insert, 'Inserting document', 1, 1, 1],
				"count": [this.count, 'Counting documents', 0, 2, 2],
				"findOne": [this.findOne, 'Finding Document', 0, 2, 2],
				"insertMany": [this.insertMany, 'Inserting documents', 1, 2, 2],
				"insertOne": [this.insertOne, 'Inserting document', 1, 2, 2],
				"deleteOne": [this.deleteOne, 'Deleting document', 1, 2, 1],
				"deleteMany": [this.deleteMany, 'Deleting documents', 1, 2, 1],
				"remove": [this.remove, 'Deleting document(s)', 1, 2, 1]
			};

			if (name in functions) {
				let functionData = functions[name];
				if (parameters.length < functionData[2]) { //has less than the min allowed
					return Promise.reject(new Error(`Too few arguments passed to command ${name}.`));
				}
				if (parameters.length > functionData[3]) { //has more than the max allowed
					return Promise.reject(new Error(`Too many arguments passed to command ${name}`));
				}
				if (parameters.length > functionData[4]) { //this function won't handle these arguments, but the shell will
					return this.deferToShell;
				}
				const mongoFunction: (args: Object[]) => Thenable<string> = functionData[0];
				return reportProgress(mongoFunction.apply(this, parameters), functionData[1]);
			}
			return this.deferToShell;
		} catch (error) {
			return Promise.reject(error);
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

	private async findOne(query?: Object, fieldsOption?: Object): Promise<string> {
		const result = await this.collection.findOne(query || {}, { fields: fieldsOption });
		// findOne is the only command in this file whose output requires EJSON support.
		// Hence that's the only function which uses EJSON.stringify rather than this.stringify.
		return EJSON.stringify(result, null, '\t');
	}

	private insert(document: Object): Thenable<string> {
		if (!document) {
			throw new Error("The insert command requires at least one argument");
		}
		return this.collection.insert(document)
			.then(({ insertedCount, insertedId, result }) => {
				return this.stringify({ insertedCount, insertedId, result });
			});
	}

	// tslint:disable-next-line:no-any
	private insertOne(document: Object, options?: any): Thenable<string> {
		return this.collection.insertOne(document, { w: options && options.writeConcern })
			.then(({ insertedCount, insertedId, result }) => {
				return this.stringify({ insertedCount, insertedId, result });
			});
	}

	//tslint:disable:no-any
	private insertMany(documents: any[], options?: any): Thenable<string> {
		let insertManyOptions: CollectionInsertManyOptions = {};
		const docsLink: string = "Please see mongo shell documentation. https://docs.mongodb.com/manual/reference/method/db.collection.insertMany/#db.collection.insertMany.";
		if (!documents) { // this code should not be hit
			return Promise.reject(new Error("Too few arguments passed to insertMany. " + docsLink));
		} else if (options) {
			if (options.ordered) {
				insertManyOptions["ordered"] = options.ordered;
			}
			if (options.writeConcern) {
				insertManyOptions["w"] = options.writeConcern;
			}
		}

		return this.collection.insertMany(documents, insertManyOptions)
			.then(({ insertedCount, insertedIds, result }) => {
				return this.stringify({ insertedCount, insertedIds, result });
			});
	}

	private remove(filter?: Object): Thenable<string> {
		return this.collection.remove(filter)
			.then(({ ops, result }) => {
				return this.stringify({ ops, result });
			});
	}

	private deleteOne(filter: Object): Thenable<string> {
		return this.collection.deleteOne(filter)
			.then(({ deletedCount, result }) => {
				return this.stringify({ deletedCount, result });
			});
	}

	private deleteMany(filter: Object): Thenable<string> {
		return this.collection.deleteMany(filter)
			.then(({ deletedCount, result }) => {
				return this.stringify({ deletedCount, result });
			});
	}

	private async count(query?: Object[], options?: MongoCountPreferences): Promise<string> {
		const count = await this.collection.count(query, options);
		return JSON.stringify(count);
	}

	// tslint:disable-next-line:no-any
	private stringify(result: any): string {
		return JSON.stringify(result, null, '\t');
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
		});
}

// tslint:disable-next-line:no-any
function parseJSContent(content: string): any {
	try {
		return EJSON.parse(content);
	} catch (error) {
		throw error.message;
	}
}
