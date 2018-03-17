/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DocumentClient, QueryIterator, CollectionMeta, RetrievedDocument, FeedOptions } from 'documentdb';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

/**
 * This class provides common logic for DocumentDB, Graph, and Table "documents" (or whatever passes for a "document" in this API type)
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBDocumentsTreeItemBase extends DocDBTreeItemBase<RetrievedDocument> {
    protected readonly _collection: CollectionMeta;

    constructor(documentEndpoint: string, masterKey: string, collection: CollectionMeta, isEmulator: boolean) {
        super(documentEndpoint, masterKey, isEmulator);
        this._collection = collection;
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

    private get link(): string {
        return this._collection._self;
    }

    //asdf
    // public get partitionKey(): CollectionPartitionKey | undefined {
    //     return this._collection.partitionKey;
    // }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<RetrievedDocument>> {
        return await client.readDocuments(this.link, feedOptions);
    }
}
