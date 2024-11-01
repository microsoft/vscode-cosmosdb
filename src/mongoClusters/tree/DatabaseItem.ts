/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { MongoClustersClient, type DatabaseItemModel } from '../MongoClustersClient';
import { CollectionItem } from './CollectionItem';
import { type MongoClusterItemBase, type MongoClusterModel } from './MongoClusterItem';

export class DatabaseItem implements MongoClusterItemBase {
    id: string;

    constructor(
        readonly subscription: AzureSubscription,
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}`;
    }

    async getChildren(): Promise<TreeElementBase[]> {
        const client: MongoClustersClient = await MongoClustersClient.getClient(this.mongoCluster.id);
        const collections = await client.listCollections(this.databaseInfo.name);
        return collections.map((collection) => {
            return new CollectionItem(this.subscription, this.mongoCluster, this.databaseInfo, collection);
        });
    }

    async delete(_context: IActionContext): Promise<boolean> {
        const client = await MongoClustersClient.getClient(this.mongoCluster.id);

        await ext.state.showDeleting(this.id, async () => {
            await client.dropDatabase(this.databaseInfo.name);
        });

        ext.state.notifyChildrenChanged(this.mongoCluster.id);

        return true;
    }

    async createCollection(_context: IActionContext, collectionName: string): Promise<boolean> {
        const client = await MongoClustersClient.getClient(this.mongoCluster.id);

        let success = false;

        await ext.state.showCreatingChild(
            this.id,
            localize('mongoClusters.tree.creating', 'Creating "{0}"...', collectionName),
            async () => {
                success = await client.createCollection(this.databaseInfo.name, collectionName);
            },
        );

        return success;
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: 'mongoClusters.item.database',
            label: this.databaseInfo.name,
            iconPath: new ThemeIcon('database'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
