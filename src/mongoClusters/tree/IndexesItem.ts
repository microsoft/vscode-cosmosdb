/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { MongoClustersClient, type CollectionItemModel, type DatabaseItemModel } from '../MongoClustersClient';
import { IndexItem } from './IndexItem';
import { type MongoClusterItemBase, type MongoClusterModel } from './MongoClusterItem';

export class IndexesItem implements MongoClusterItemBase {
    id: string;

    constructor(
        readonly subscription: AzureSubscription,
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}/${collectionInfo.name}/indexes`;
    }

    async getChildren(): Promise<TreeElementBase[]> {
        const client: MongoClustersClient = await MongoClustersClient.getClient(this.mongoCluster.id);
        const indexes = await client.listIndexes(this.databaseInfo.name, this.collectionInfo.name);
        return indexes.map((index) => {
            return new IndexItem(this.subscription, this.mongoCluster, this.databaseInfo, this.collectionInfo, index);
        });
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            label: 'Indexes',
            iconPath: new ThemeIcon('combine'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
