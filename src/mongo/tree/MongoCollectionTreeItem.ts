/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any */

import { AzExtParentTreeItem, AzExtTreeItem, DialogResponses, IActionContext, ICreateChildImplContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as assert from 'assert';
import { BulkWriteOpResultObject, Collection, CollectionInsertManyOptions, Cursor, DeleteWriteOpResultObject, InsertOneWriteOpResult, InsertWriteOpResult, MongoCountPreferences } from 'mongodb';
import * as _ from 'underscore';
import * as vscode from 'vscode';
import { IEditableTreeItem } from '../../DatabasesFileSystem';
import { ext } from '../../extensionVariables';
import { nonNullValue } from '../../utils/nonNull';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { getBatchSizeSetting } from '../../utils/workspacUtils';
import { MongoCommand } from '../MongoCommand';
import { IMongoDocument, MongoDocumentTreeItem } from './MongoDocumentTreeItem';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const EJSON = require("mongodb-extended-json");

type MongoFunction = (...args: ({} | {}[] | undefined)[]) => Thenable<string>;
type MongoDocument = { _id: string };
class FunctionDescriptor {
    public constructor(public mongoFunction: MongoFunction, public text: string, public minShellArgs: number, public maxShellArgs: number, public maxHandledArgs: number) {
    }
}

export class MongoCollectionTreeItem extends AzExtParentTreeItem implements IEditableTreeItem {
    public static contextValue: string = "MongoCollection";
    public readonly contextValue: string = MongoCollectionTreeItem.contextValue;
    public readonly childTypeLabel: string = "Document";
    public readonly collection: Collection;
    public parent: AzExtParentTreeItem;
    public findArgs?: {}[];
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    private readonly _query: object | undefined;
    private readonly _projection: object | undefined;
    private _cursor: Cursor | undefined;
    private _hasMoreChildren: boolean = true;
    private _batchSize: number = getBatchSizeSetting();

    constructor(parent: AzExtParentTreeItem, collection: Collection, findArgs?: {}[]) {
        super(parent);
        this.collection = collection;
        this.findArgs = findArgs;
        if (findArgs && findArgs.length) {
            this._query = findArgs[0];
            this._projection = findArgs.length > 1 ? findArgs[1] : undefined;
        }
        ext.fileSystem.fireChangedEvent(this);
    }

    public async writeFileContent(context: IActionContext, content: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const documents: IMongoDocument[] = EJSON.parse(content);
        const operations = documents.map((document) => {
            return {
                replaceOne: {
                    filter: { _id: document._id },
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                    replacement: _.omit(document, '_id'),
                    upsert: false
                }
            };
        });

        const result: BulkWriteOpResultObject = await this.collection.bulkWrite(operations);
        ext.outputChannel.appendLog(`Successfully updated ${result.modifiedCount} document(s), inserted ${result.insertedCount} document(s)`);

        // The current tree item may have been a temporary one used to execute a scrapbook command.
        // We want to refresh children for this one _and_ the actual one in the tree (if it's different)
        const nodeInTree: MongoCollectionTreeItem | undefined = await ext.tree.findTreeItem(this.fullId, context);
        const nodesToRefresh: MongoCollectionTreeItem[] = [this];
        if (nodeInTree && this !== nodeInTree) {
            nodesToRefresh.push(nodeInTree);
        }

        await Promise.all(nodesToRefresh.map(n => n.refreshChildren(context, documents)));

        if (nodeInTree && this !== nodeInTree) {
            // Don't need to fire a changed event on the item being saved at the moment. Just the node in the tree if it's different
            ext.fileSystem.fireChangedEvent(nodeInTree);
        }
    }

    public async getFileContent(context: IActionContext): Promise<string> {
        const children = <MongoDocumentTreeItem[]>await this.getCachedChildren(context);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        return EJSON.stringify(children.map(c => c.document), null, 2);
    }

    public get id(): string {
        return this.collection.collectionName;
    }

    public get label(): string {
        return this.collection.collectionName;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('files');
    }

    public get filePath(): string {
        return this.label + '-cosmos-collection.json';
    }

    public async refreshImpl(): Promise<void> {
        this._batchSize = getBatchSizeSetting();
        ext.fileSystem.fireChangedEvent(this);
    }

    public async refreshChildren(context: IActionContext, docs: IMongoDocument[]): Promise<void> {
        const documentNodes = <MongoDocumentTreeItem[]>await this.getCachedChildren(context);
        for (const doc of docs) {
            const documentNode = documentNodes.find((node) => node.document._id.toString() === doc._id.toString());
            if (documentNode) {
                documentNode.document = doc;
                await documentNode.refresh(context);
            }
        }
    }

    public hasMoreChildrenImpl(): boolean {
        return this._hasMoreChildren;
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (clearCache || this._cursor === undefined) {
            this._cursor = this.collection.find(this._query).batchSize(this._batchSize);
            if (this._projection) {
                this._cursor = this._cursor.project(this._projection);
            }
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

        return this.createTreeItemsWithErrorHandling<IMongoDocument>(
            documents,
            'invalidMongoDocument',
            doc => new MongoDocumentTreeItem(this, doc),
            getDocumentTreeItemLabel
        );
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<MongoDocumentTreeItem> {
        context.showCreatingTreeItem("");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: InsertOneWriteOpResult<MongoDocument> = await this.collection.insertOne({});
        const newDocument: IMongoDocument = nonNullValue(await this.collection.findOne({ _id: result.insertedId }), 'newDocument');
        return new MongoDocumentTreeItem(this, newDocument);
    }

    public async tryExecuteCommandDirectly(command: Partial<MongoCommand>): Promise<{ deferToShell: true; result: undefined } | { deferToShell: false; result: string }> {
        // range and text are not neccessary properties for this function so partial should suffice
        const parameters = command.arguments ? command.arguments.map(parseJSContent) : [];

        const functions = {
            drop: new FunctionDescriptor(this.drop, 'Dropping collection', 0, 0, 0),
            count: new FunctionDescriptor(this.count, 'Counting documents', 0, 2, 2),
            findOne: new FunctionDescriptor(this.findOne, 'Finding document', 0, 2, 2),
            insert: new FunctionDescriptor(this.insert, 'Inserting document', 1, 1, 1),
            insertMany: new FunctionDescriptor(this.insertMany, 'Inserting documents', 1, 2, 2),
            insertOne: new FunctionDescriptor(this.insertOne, 'Inserting document', 1, 2, 2),
            deleteMany: new FunctionDescriptor(this.deleteMany, 'Deleting documents', 1, 2, 1),
            deleteOne: new FunctionDescriptor(this.deleteOne, 'Deleting document', 1, 2, 1),
            remove: new FunctionDescriptor(this.remove, 'Deleting document(s)', 1, 2, 1)
        };

        // eslint-disable-next-line no-prototype-builtins
        if (command.name && functions.hasOwnProperty(command.name)) {
            // currently no logic to handle chained commands so just defer to the shell right away
            if (command.chained) {
                return { deferToShell: true, result: undefined };
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const descriptor: FunctionDescriptor = functions[command.name];

            if (parameters.length < descriptor.minShellArgs) {
                throw new Error(`Too few arguments passed to command ${command.name}.`);
            }
            if (parameters.length > descriptor.maxShellArgs) {
                throw new Error(`Too many arguments passed to command ${command.name}`);
            }
            if (parameters.length > descriptor.maxHandledArgs) { //this function won't handle these arguments, but the shell will
                return { deferToShell: true, result: undefined };
            }
            const result = await reportProgress<string>(descriptor.mongoFunction.apply(this, parameters), descriptor.text);
            return { deferToShell: false, result };
        }
        return { deferToShell: true, result: undefined };
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const message: string = `Are you sure you want to delete collection '${this.label}'?`;
        await context.ui.showWarningMessage(message, { modal: true, stepName: 'deleteMongoCollection' }, DialogResponses.deleteResponse);
        await this.drop();
    }

    private async drop(): Promise<string> {
        try {
            await this.collection.drop();
            return `Dropped collection '${this.collection.collectionName}'.`;
        } catch (e) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const error: { code?: number, name?: string } = e;
            const NamespaceNotFoundCode = 26;
            if (error.name === 'MongoError' && error.code === NamespaceNotFoundCode) {
                return `Collection '${this.collection.collectionName}' could not be dropped because it does not exist.`;
            } else {
                throw error;
            }
        }
    }

    private async findOne(query?: Object, fieldsOption?: Object): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = await this.collection.findOne(query || {}, { fields: fieldsOption });
        // findOne is the only command in this file whose output requires EJSON support.
        // Hence that's the only function which uses EJSON.stringify rather than this.stringify.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        return EJSON.stringify(result, null, '\t');
    }

    private async insert(document: Object): Promise<string> {
        if (!document) {
            throw new Error("The insert command requires at least one argument");
        }

        const insertResult = await this.collection.insert(document);
        return this.stringify(insertResult);
    }

    private async insertOne(document: Object, options?: any): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const insertOneResult: InsertOneWriteOpResult<MongoDocument> = await this.collection.insertOne(document, { w: options && options.writeConcern });
        return this.stringify(insertOneResult);
    }

    private async insertMany(documents: any[], options?: any): Promise<string> {
        assert.notEqual(documents.length, 0, "Array of documents cannot be empty");
        const insertManyOptions: CollectionInsertManyOptions = {};
        if (options) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (options.ordered) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                insertManyOptions.ordered = options.ordered;
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (options.writeConcern) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                insertManyOptions.w = options.writeConcern;
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const insertManyResult: InsertWriteOpResult<MongoDocument> = await this.collection.insertMany(documents, insertManyOptions);
        return this.stringify(insertManyResult);
    }

    private async remove(filter: Object): Promise<string> {
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

function parseJSContent(content: string): any {
    try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        return EJSON.parse(content);
    } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        throw error.message;
    }
}
