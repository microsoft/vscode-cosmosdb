/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as _ from 'underscore';
import * as vscode from 'vscode';
import * as path from 'path';
import { Collection, ObjectID, DeleteWriteOpResultObject, UpdateWriteOpResult } from 'mongodb';
import { IAzureTreeItem, IAzureNode, UserCancelledError, DialogResponses } from 'vscode-azureextensionui';

export interface IMongoDocument {
    _id: string | ObjectID;

    // custom properties
    // tslint:disable-next-line:no-any
    [key: string]: any;
}

export class MongoDocumentTreeItem implements IAzureTreeItem {
    public static contextValue: string = "MongoDocument";
    public readonly contextValue: string = MongoDocumentTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openDocument';
    public document: IMongoDocument;

    private _collection: Collection;

    constructor(document: IMongoDocument, collection: Collection) {
        this.document = document;
        this._collection = collection;
    }

    get id(): string {
        return this.document._id.toString();
    }

    get label(): string {
        return this.document._id.toString();
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Document.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Document.svg'),
        };
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete document '${this.label}'?`;
        const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const result: DeleteWriteOpResultObject = await this._collection.deleteOne({ "_id": this.document._id });
            if (result.deletedCount != 1) {
                throw new Error(`Failed to delete document with _id '${this.document._id}'.`);
            }
        } else {
            throw new UserCancelledError();
        }
    }

    public async update(newDocument: IMongoDocument): Promise<IMongoDocument> {
        this.document = await MongoDocumentTreeItem.update(this._collection, newDocument);
        return this.document;
    }

    public static async update(collection: Collection, newDocument: IMongoDocument): Promise<IMongoDocument> {
        if (!newDocument["_id"]) {
            throw new Error(`The "_id" field is required to update a document.`);
        }
        const filter: object = { _id: newDocument._id };
        const result: UpdateWriteOpResult = await collection.updateOne(filter, _.omit(newDocument, '_id'));
        if (result.modifiedCount != 1) {
            throw new Error(`Failed to update document with _id '${newDocument._id}'.`);
        }
        return newDocument;
    }
}
