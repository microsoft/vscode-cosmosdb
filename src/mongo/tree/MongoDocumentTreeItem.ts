/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzExtTreeItem,
    DialogResponses,
    type IActionContext,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import { EJSON } from 'bson';
import { omit } from 'lodash-es';
import {
    type Collection,
    type DeleteResult,
    type Document as MongoDocument,
    type ObjectId,
    type UpdateResult,
} from 'mongodb';
import * as vscode from 'vscode';
import { type IEditableTreeItem } from '../../DatabasesFileSystem';
import { ext } from '../../extensionVariables';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { type MongoCollectionTreeItem } from './MongoCollectionTreeItem';

export interface IMongoDocument {
    _id: ObjectId;

    // custom properties
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
}

export class MongoDocumentTreeItem extends AzExtTreeItem implements IEditableTreeItem {
    public static contextValue: string = 'MongoDocument';
    public readonly contextValue: string = MongoDocumentTreeItem.contextValue;
    public document: IMongoDocument;
    public readonly parent: MongoCollectionTreeItem;
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    private _label: string;

    constructor(parent: MongoCollectionTreeItem, document: IMongoDocument) {
        super(parent);
        this.document = document;
        this._label = getDocumentTreeItemLabel(this.document);
        this.commandId = 'cosmosDB.openDocument';
        ext.fileSystem.fireChangedEvent(this);
    }

    public get id(): string {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const result: MongoDocument | UpdateResult = await collection.replaceOne(filter, omit(newDocument, '_id'));
        if (result.modifiedCount !== 1) {
            throw new Error(`Failed to update document with _id '${newDocument._id}'.`);
        }
        return newDocument;
    }

    public async getFileContent(): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        return EJSON.stringify(this.document, undefined, 2);
    }

    public async refreshImpl(): Promise<void> {
        this._label = getDocumentTreeItemLabel(this.document);
        ext.fileSystem.fireChangedEvent(this);
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const message: string = `Are you sure you want to delete document '${this._label}'?`;
        await context.ui.showWarningMessage(
            message,
            { modal: true, stepName: 'deleteMongoDocument' },
            DialogResponses.deleteResponse,
        );
        const deleteResult: DeleteResult = await this.parent.collection.deleteOne({ _id: this.document._id });
        if (deleteResult.deletedCount !== 1) {
            throw new Error(`Failed to delete document with _id '${this.document._id}'.`);
        }
    }

    public async writeFileContent(_context: IActionContext, content: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const newDocument: IMongoDocument = EJSON.parse(content);
        this.document = await MongoDocumentTreeItem.update(this.parent.collection, newDocument);
    }
}
