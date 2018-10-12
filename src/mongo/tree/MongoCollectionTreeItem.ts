/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BulkWriteOpResultObject, Collection, CollectionInsertManyOptions, Cursor, DeleteWriteOpResultObject, InsertOneWriteOpResult, InsertWriteOpResult, MongoCountPreferences } from 'mongodb';
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

	constructor(collection: Collection, query?: Object[]) {
		this.collection = collection;
		if (query && query.length) {
			this._query = query[0];
			this._projection = query.length > 1 && query[1];
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

		const docTreeItems = documents.map((document: IMongoDocument) => new MongoDocumentTreeItem(document, this.collection));
		return docTreeItems;
	}

	public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
		showCreatingNode("");
		const result: InsertOneWriteOpResult = await this.collection.insertOne({});
		const newDocument: IMongoDocument = await this.collection.findOne({ _id: result.insertedId });
		return new MongoDocumentTreeItem(newDocument, this.collection);
	}

	executeCommand(name: string, args?: string[]): Thenable<string> | null {
		const parameters = args ? args.map(parseJSContent) : undefined;
		const deferToShell = null; //The value executeCommand returns to instruct the caller function to run the same command in the Mongo shell.

		try {
			type MongoFunction = (...args: Object[]) => Thenable<string>;
			let functions: { [functionName: string]: [MongoFunction, string, number, number, number] } = {
				/*
				format: command name (from the argument) :
				0: corresponding function call,
				1: text to show during the operation,
				2: min number of args allowed by the shell
				3: max number of args allowed by the shell
				4: Max number of args executeCommand supports, i.e., has mapper code to convert options provided - to the shell - into an API compatible options object
				4th element <= 3rd element
				*/
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
				const mongoFunction: (args: Object[]) => Thenable<string> = functionData[0];
				let pendingText: string = functionData[1];
				let minArgs: number = functionData[2];
				let maxArgs: number = functionData[3];
				let handledMaxArgs: number = functionData[4];
				if (parameters.length < minArgs) { //has less than the min allowed
					return Promise.reject(new Error(`Too few arguments passed to command ${name}.`));
				}
				if (parameters.length > maxArgs) { //has more than the max allowed
					return Promise.reject(new Error(`Too many arguments passed to command ${name}`));
				}
				if (parameters.length > handledMaxArgs) { //this function won't handle these arguments, but the shell will
					return deferToShell;
				}
				return reportProgress(mongoFunction.apply(this, parameters), pendingText);
			}
			return deferToShell;
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

	private async insert(document: Object): Promise<string> {
		if (!document) {
			throw new Error("The insert command requires at least one argument");
		}
		const insertResult = await this.collection.insert(document);
		return this.stringify(insertResult);
	}

	// tslint:disable-next-line:no-any
	private async insertOne(document: Object, options?: any): Promise<string> {
		const insertOneResult: InsertOneWriteOpResult = await this.collection.insertOne(document, { w: options && options.writeConcern });
		return this.stringify(insertOneResult);
	}

	//tslint:disable:no-any
	private async insertMany(documents: any[], options?: any): Promise<string> {
		assert.notEqual(documents.length, 0, "Array of documents cannot be empty");
		let insertManyOptions: CollectionInsertManyOptions = {};
		if (options) {
			if (options.ordered) {
				insertManyOptions["ordered"] = options.ordered;
			}
			if (options.writeConcern) {
				insertManyOptions["w"] = options.writeConcern;
			}
		}

		const insertManyResult: InsertWriteOpResult = await this.collection.insertMany(documents, insertManyOptions);
		return this.stringify(insertManyResult);
	}

	private async remove(filter?: Object): Promise<string> {
		const removeResult = await this.collection.remove(filter);
		return this.stringify(removeResult);
	}

	private async deleteOne(filter: Object): Promise<string> {
		const deleteOneResult: DeleteWriteOpResultObject = await this.collection.deleteOne(filter);
		return this.stringify(deleteOneResult);
	}

	private async deleteMany(filter: Object): Promise<string> {
		const deleteOpResult: DeleteWriteOpResultObject = await this.collection.deleteMany(filter);
		return this.stringify(deleteOpResult);
	}

	private async count(query?: Object[], options?: MongoCountPreferences): Promise<string> {
		const count = await this.collection.count(query, options);
		return this.stringify(count);
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
			title: title
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
