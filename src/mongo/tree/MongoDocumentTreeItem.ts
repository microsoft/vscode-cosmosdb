/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as _ from 'underscore';
import * as vscode from 'vscode';
import * as path from 'path';
import { Collection, ObjectID } from 'mongodb';
import { IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { DialogBoxResponses } from '../../constants';

export interface IMongoDocument {
    _id: string | ObjectID;

    // custom properties
    [key: string]: any;
}

export class MongoDocumentTreeItem implements IAzureTreeItem {
    public static contextValue: string = "MongoDocument";
    public readonly contextValue: string = MongoDocumentTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openDocument';

    private _document: IMongoDocument;
    private _collection: Collection;
    private _parentId: string;

    constructor(document: IMongoDocument, collection: Collection, parentId: string) {
        this._document = document;
        this._collection = collection;
        this._parentId = parentId;
    }

    get id(): string {
        return `${this._parentId}/${this.document._id}`;
    }

    get label(): string {
        return this.document._id.toString();
    }

    get document(): IMongoDocument {
        return this._document;
    }

    get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Document.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Document.svg'),
        };
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete document '${this.label}' ? `;
        const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes);
        if (result === DialogBoxResponses.Yes) {
            await this._collection.deleteOne({ "_id": this.document._id });
        } else {
            throw new UserCancelledError();
        }
    }

    public async update(newDocument: IMongoDocument): Promise<IMongoDocument> {
        const filter: object = { _id: new ObjectID(newDocument._id) };
        await this._collection.updateOne(filter, _.omit(newDocument, '_id'));
        this._document = newDocument;
        return newDocument;
    }
}
