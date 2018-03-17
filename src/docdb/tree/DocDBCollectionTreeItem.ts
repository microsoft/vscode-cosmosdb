/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionMeta, DocumentClient, CollectionPartitionKey } from 'documentdb';
import { IAzureNode, IAzureTreeItem, IAzureParentTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import * as vscode from 'vscode';
import * as DocDBLib from 'documentdb/lib';
import { DocDBStoredProceduresTreeItem } from './DocDBStoredProceduresTreeItem';
import { DocDBDocumentsTreeItem } from './DocDBDocumentsTreeItem';
import * as path from "path";
import { DialogBoxResponses } from '../../constants';

// asdf create base class for this?
export class DocDBCollectionTreeItem implements IAzureParentTreeItem {
    public static contextValue: string = "cosmosDBDocumentCollection";
    public readonly contextValue: string = DocDBCollectionTreeItem.contextValue;

    constructor(
        private _documentEndpoint: string,
        private _masterKey: string,
        private _collection: CollectionMeta,
        private _isEmulator: boolean) {
    }

    public get id(): string {
        return this._collection.id;
    }

    public get label(): string {
        return this._collection.id;
    }

    public get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg')
        };
    }

    public async loadMoreChildren(node: IAzureNode<IAzureTreeItem>, clearCache: boolean): Promise<IAzureTreeItem[]> {
        return [
            new DocDBDocumentsTreeItem(this._documentEndpoint, this._masterKey, this, this._isEmulator),
            new DocDBStoredProceduresTreeItem(this._documentEndpoint, this._masterKey, this._collection, this._isEmulator)
        ];
    }

    public hasMoreChildren(): boolean {
        return false;
    }

    public get link(): string {
        return this._collection._self;
    }

    public get partitionKey(): CollectionPartitionKey | undefined {
        return this._collection.partitionKey;
    }

    // asdf shared code?
    public getDocumentClient(): DocumentClient {
        const documentBase = DocDBLib.DocumentBase;
        var connectionPolicy = new documentBase.ConnectionPolicy();
        connectionPolicy.DisableSSLVerification = this._isEmulator;
        const client = new DocumentClient(this._documentEndpoint, { masterKey: this._masterKey }, connectionPolicy);
        return client;
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete collection '${this.label}' and its contents?`;
        const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
        if (result === DialogBoxResponses.Yes) {
            const client = this.getDocumentClient();
            await new Promise((resolve, reject) => {
                client.deleteCollection(this.link, function (err) {
                    err ? reject(err) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }
}
