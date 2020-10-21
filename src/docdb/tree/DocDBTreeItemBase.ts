/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, FeedOptions, QueryIterator } from '@azure/cosmos';
import { AzExtTreeItem, AzureParentTreeItem, AzureTreeItem } from 'vscode-azureextensionui';
import { getBatchSizeSetting } from '../../utils/workspacUtils';
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
    private _batchSize: number = getBatchSizeSetting();

    public hasMoreChildrenImpl(): boolean {
        return this._hasMoreChildren;
    }

    public abstract initChild(resource: T): AzureTreeItem<IDocDBTreeRoot>;

    public abstract getIterator(client: CosmosClient, feedOptions: FeedOptions): Promise<QueryIterator<T>>;

    public async refreshImpl(): Promise<void> {
        this._batchSize = getBatchSizeSetting();
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (clearCache || this._iterator === undefined) {
            this._hasMoreChildren = true;
            const client = this.root.getDocumentClient();
            this._iterator = await this.getIterator(client, { maxItemCount: this._batchSize });
        }

        const resources: T[] = [];
        let count: number = 0;
        while (count < this._batchSize) {
            const resourceArray: T[] | undefined = (await this._iterator.fetchNext()).resources;
            if (resourceArray === undefined) {
                this._hasMoreChildren = false;
                break;
            } else {
                resources.push(...resourceArray);
                count += 1;
            }
        }
        this._batchSize *= 2;
        return resources.map((resource: T) => this.initChild(resource));
    }
}
