/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, FeedOptions, QueryIterator } from '@azure/cosmos';
import { AzExtParentTreeItem, AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { getBatchSizeSetting } from '../../utils/workspacUtils';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * This class provides common iteration logic for DocumentDB accounts, databases, and collections
 */
export abstract class DocDBTreeItemBase<T> extends AzExtParentTreeItem {
    public abstract readonly label: string;
    public abstract readonly contextValue: string;
    public abstract readonly childTypeLabel: string;

    private _hasMoreChildren: boolean = true;
    private _iterator: QueryIterator<T> | undefined;
    private _batchSize: number = getBatchSizeSetting();

    public hasMoreChildrenImpl(): boolean {
        return this._hasMoreChildren;
    }

    public abstract get root(): IDocDBTreeRoot;

    public abstract initChild(resource: T): AzExtTreeItem;

    public abstract getIterator(client: CosmosClient, feedOptions: FeedOptions): QueryIterator<T>;

    public async refreshImpl(): Promise<void> {
        this._batchSize = getBatchSizeSetting();
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (clearCache || this._iterator === undefined) {
            this._hasMoreChildren = true;
            const client = this.root.getCosmosClient();
            this._iterator = this.getIterator(client, { maxItemCount: this._batchSize });
        }

        const resourceArray: T[] = [];
        const resourceFeed: T[] | undefined = (await this._iterator.fetchNext()).resources;
        if (resourceFeed) {
            resourceArray.push(...resourceFeed);
        }
        this._hasMoreChildren = this._iterator.hasMoreResults();

        this._batchSize *= 2;

        return resourceArray.map((resource: T) => this.initChild(resource));
    }
}
