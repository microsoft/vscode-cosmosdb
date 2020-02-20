// /*---------------------------------------------------------------------------------------------
//  *  Copyright (c) Microsoft Corporation. All rights reserved.
//  *  Licensed under the MIT License. See License.txt in the project root for license information.
//  *--------------------------------------------------------------------------------------------*/

import { Collection, DeleteWriteOpResultObject, ObjectID, UpdateWriteOpResult } from 'mongodb';
import * as _ from 'underscore';
import * as vscode from 'vscode';
import { AzureTreeItem, DialogResponses, UserCancelledError } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { IPostgreSQLTreeRoot } from './IPostgreSQLTreeRoot';
import { PostgreSQLDatabaseTreeItem } from './PostgreSQLDatabaseTreeItem';

export class IPostgresTable {
    public _id: string;
    public _name: string;
    public _data: any;

    // custom properties
    // tslint:disable-next-line:no-any
    constructor(id, name, rows) {
        this._id = id;
        this._name = name;
        this._data = rows;
    }
}

export class PostgreSQLTableTreeItem extends AzureTreeItem<IPostgreSQLTreeRoot> {
    public static contextValue: string = "PostgresTable";
    public readonly contextValue: string = PostgreSQLTableTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openDocument';
    public document: IPostgresTable;
    public readonly parent: PostgreSQLDatabaseTreeItem;

    private _label;

    constructor(parent: PostgreSQLDatabaseTreeItem, document: IPostgresTable) {
        super(parent);
        this.document = document;
        this._label = getDocumentTreeItemLabel(this.document);
    }

    // public static contextValue: string = "MongoDocument";
    // public readonly contextValue: string = PostgreSQLTableTreeItem.contextValue;
    // public readonly commandId: string = 'cosmosDB.openDocument';

    // public readonly parent: PostgreSQLDatabaseTreeItem;

    // private _label = "TEST";

    // constructor(parent: PostgreSQLDatabaseTreeItem) {
    //     super(parent);
    //     // this._label = getDocumentTreeItemLabel();
    // }

    public get id(): string {
        // tslint:disable-next-line:no-non-null-assertion
        return String();
    }

    public get label(): string {
        return this._label;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Document.svg');
    }

    public static async update(newDocument: IPostgresTable): Promise<IPostgresTable> {
        if (!newDocument._id) {
            throw new Error(`The "_id" field is required to update a document.`);
        }
        const filter: object = { _id: newDocument._id };
        // const result: UpdateWriteOpResult = await collection.replaceOne(filter, _.omit(newDocument, '_id'));
        // if (result.modifiedCount !== 1) {
        //     throw new Error(`Failed to update document with _id '${newDocument._id}'.`);
        // }
        return newDocument;
    }

    // public async refreshImpl(): Promise<void> {
    //     this._label = getDocumentTreeItemLabel(this.document);
    // }

    // public async deleteTreeItemImpl(): Promise<void> {
    //     const message: string = `Are you sure you want to delete document '${this._label}'?`;
    //     const dialogResult = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
    //     if (dialogResult === DialogResponses.deleteResponse) {
    //         const deleteResult: DeleteWriteOpResultObject = await this.parent.collection.deleteOne({ _id: this.document._id });
    //         if (deleteResult.deletedCount !== 1) {
    //             throw new Error(`Failed to delete document with _id '${this.document._id}'.`);
    //         }
    //     } else {
    //         throw new UserCancelledError();
    //     }
    // }

    public async update(newDocument: IPostgresTable): Promise<IPostgresTable> {
        this.document = await PostgreSQLTableTreeItem.update(newDocument);
        return this.document;
    }
}
