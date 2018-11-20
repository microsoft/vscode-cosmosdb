/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentClient, FeedOptions, QueryError, QueryIterator } from 'documentdb';
import { AzureParentTreeItem, AzureTreeItem } from 'vscode-azureextensionui';
import { defaultBatchSize } from '../../constants';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * This class provides common iteration logic for DocumentDB accounts, databases, and collections
 */
export abstract class DocDBTreeItemBase<T> extends AzureParentTreeItem<IDocDBTreeRoot> {
    public abstract readonly id: string;
    public abstract readonly label: string;
    public abstract readonly contextValue: string;
    public abstract readonly childTypeLabel: string;

    private _hasMoreChildren: boolean = true;
    private _iterator: QueryIterator<T> | undefined;
    private _batchSize: number = defaultBatchSize;

    public hasMoreChildrenImpl(): boolean {
        return this._hasMoreChildren;
    }

    public abstract initChild(resource: T): AzureTreeItem<IDocDBTreeRoot>;

    public abstract getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<T>>;

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzureTreeItem<IDocDBTreeRoot>[]> {
        if (clearCache || this._iterator === undefined) {
            this._hasMoreChildren = true;
            const client = this.root.getDocumentClient();
            this._iterator = await this.getIterator(client, { maxItemCount: defaultBatchSize });
            this._batchSize = defaultBatchSize;
        }

        const resources: T[] = [];
        let count: number = 0;
        while (count < this._batchSize) {
            const resource: T | undefined = await new Promise<T | undefined>((resolve, reject) => {
                this._iterator.nextItem((error: QueryError, rsrc: T | undefined) => {
                    error ? reject(error) : resolve(rsrc);
                });
            });
            if (resource === undefined) {
                this._hasMoreChildren = false;
                break;
            } else {
                resources.push(resource);
                count += 1;
            }
        }
        this._batchSize *= 2;

        return resources.map((resource: T) => this.initChild(resource));
    }
}
