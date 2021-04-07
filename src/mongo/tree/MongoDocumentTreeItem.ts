/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Collection, DeleteWriteOpResultObject, ObjectID, UpdateWriteOpResult } from 'mongodb';
import * as _ from 'underscore';
import * as vscode from 'vscode';
import { AzureTreeItem, DialogResponses, IActionContext, TreeItemIconPath, UserCancelledError } from 'vscode-azureextensionui';
import { IEditableTreeItem } from '../../DatabasesFileSystem';
import { ext } from '../../extensionVariables';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { IMongoTreeRoot } from './IMongoTreeRoot';
import { MongoCollectionTreeItem } from './MongoCollectionTreeItem';
// tslint:disable:no-var-requires no-require-imports
const EJSON = require("mongodb-extended-json");

export interface IMongoDocument {
    _id: string | ObjectID;

    // custom properties
    // tslint:disable-next-line:no-any
    [key: string]: any;
}

export class MongoDocumentTreeItem extends AzureTreeItem<IMongoTreeRoot> implements IEditableTreeItem {
    public static contextValue: string = "MongoDocument";
    public readonly contextValue: string = MongoDocumentTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openDocument';
    public document: IMongoDocument;
    public readonly parent: MongoCollectionTreeItem;
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    private _label: string;

    constructor(parent: MongoCollectionTreeItem, document: IMongoDocument) {
        super(parent);
        this.document = document;
        this._label = getDocumentTreeItemLabel(this.document);
        ext.fileSystem.fireChangedEvent(this);
    }

    public get id(): string {
        // tslint:disable-next-line:no-non-null-assertion
        return String(this.document!._id);
    }

    public get label(): string {
        return this._label;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('file');
    }

    public get filePath(): string {
        return this.label + '-cosmos-document.json';
    }

    public static async update(collection: Collection, newDocument: IMongoDocument): Promise<IMongoDocument> {
        if (!newDocument._id) {
            throw new Error(`The "_id" field is required to update a document.`);
        }
        const filter: object = { _id: newDocument._id };
        const result: UpdateWriteOpResult = await collection.replaceOne(filter, _.omit(newDocument, '_id'));
        if (result.modifiedCount !== 1) {
            throw new Error(`Failed to update document with _id '${newDocument._id}'.`);
        }
        return newDocument;
    }

    public async getFileContent(): Promise<string> {
        return EJSON.stringify(this.document, null, 2);
    }

    public async refreshImpl(): Promise<void> {
        this._label = getDocumentTreeItemLabel(this.document);
        ext.fileSystem.fireChangedEvent(this);
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const message: string = `Are you sure you want to delete document '${this._label}'?`;
        const dialogResult = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (dialogResult === DialogResponses.deleteResponse) {
            const deleteResult: DeleteWriteOpResultObject = await this.parent.collection.deleteOne({ _id: this.document._id });
            if (deleteResult.deletedCount !== 1) {
                throw new Error(`Failed to delete document with _id '${this.document._id}'.`);
            }
        } else {
            throw new UserCancelledError();
        }
    }

    public async writeFileContent(_context: IActionContext, content: string): Promise<void> {
        const newDocument: IMongoDocument = EJSON.parse(content);
        this.document = await MongoDocumentTreeItem.update(this.parent.collection, newDocument);
    }
}
