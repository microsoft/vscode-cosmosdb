/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionMeta, DocumentClient } from 'documentdb';
import * as path from 'path';
import * as vscode from 'vscode';
import { DialogResponses, IAzureNode, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { getDocumentClient } from '../../docdb/getDocumentClient';
import { DocDBDocumentsTreeItem } from '../../docdb/tree/DocDBDocumentsTreeItem';
import { DocDBDocumentTreeItem } from '../../docdb/tree/DocDBDocumentTreeItem';
import { DocDBStoredProceduresTreeItem } from '../../docdb/tree/DocDBStoredProceduresTreeItem';
import { DocDBStoredProcedureTreeItem } from '../../docdb/tree/DocDBStoredProcedureTreeItem';
import { GraphDatabaseTreeItem } from './GraphDatabaseTreeItem';
import { GraphTreeItem } from './GraphTreeItem';

export class GraphCollectionTreeItem implements IAzureTreeItem {
    public static contextValue: string = "cosmosDBGraph";
    public readonly contextValue: string = GraphCollectionTreeItem.contextValue;

    private readonly _graphTreeItem: GraphTreeItem;
    private readonly _storedProceduresTreeItem: DocDBStoredProceduresTreeItem;

    private readonly _database: GraphDatabaseTreeItem;
    private readonly _collection: CollectionMeta;

    constructor(database: GraphDatabaseTreeItem, collection: CollectionMeta, private _documentEndpoint: string, private _masterKey: string, private _isEmulator: boolean) {
        this._database = database;
        this._collection = collection;
        this._graphTreeItem = new GraphTreeItem(this._database, this._collection);
        this._storedProceduresTreeItem = new DocDBStoredProceduresTreeItem(this._documentEndpoint, this._masterKey, this, this._isEmulator);
    }

    public get id(): string {
        return this._collection.id;
    }

    public get label(): string {
        return this._collection.id;
    }

    public get link(): string {
        return this._collection._self;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg')
        };
    }

    public getDocumentClient(): DocumentClient {
        return getDocumentClient(this._documentEndpoint, this._masterKey, this._isEmulator);
    }

    public async loadMoreChildren(_node: IAzureNode<IAzureTreeItem>, _clearCache: boolean): Promise<IAzureTreeItem[]> {
        return [this._graphTreeItem, this._storedProceduresTreeItem];
    }

    public hasMoreChildren(): boolean {
        return false;
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete graph '${this.label}' and its contents?`;
        const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const client = this._database.getDocumentClient();
            await new Promise((resolve, reject) => {
                // tslint:disable-next-line:no-function-expression // Grandfathered in
                client.deleteCollection(this.link, function (err) {
                    err ? reject(err) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }

    public pickTreeItem?(expectedContextValue: string): IAzureTreeItem | undefined {
        switch (expectedContextValue) {
            case DocDBDocumentsTreeItem.contextValue:
            case DocDBDocumentTreeItem.contextValue:
            case GraphTreeItem.contextValue:
                return this._graphTreeItem;

            case DocDBStoredProceduresTreeItem.contextValue:
            case DocDBStoredProcedureTreeItem.contextValue:
                return this._storedProceduresTreeItem;

            default:
                return undefined;
        }
    }

}
