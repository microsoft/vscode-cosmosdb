/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { DocumentClient, QueryIterator, CollectionMeta, RetrievedDocument, CollectionPartitionKey, FeedOptions } from 'documentdb';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { DialogBoxResponses } from '../../constants';

/**
 * This class provides common logic for DocumentDB, Graph, and Table collections
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBCollectionTreeItemBase extends DocDBTreeItemBase<RetrievedDocument> {
    private readonly _collection: CollectionMeta;
    private readonly _parentId: string;

    constructor(documentEndpoint: string, masterKey: string, collection: CollectionMeta, parentId: string, isEmulator: boolean) {
        super(documentEndpoint, masterKey, isEmulator);
        this._collection = collection;
        this._parentId = parentId;
    }

    public get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg')
        };
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

    public get partitionKey(): CollectionPartitionKey | undefined {
        return this._collection.partitionKey;
    }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<RetrievedDocument>> {
        return await client.readDocuments(this.link, feedOptions);
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
