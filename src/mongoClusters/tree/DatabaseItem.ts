import { nonNullValue, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
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
        const client: MongoClustersClient = await MongoClustersClient.getClient(
            nonNullValue(this.mongoCluster.session?.clientId),
        );
        const collections = await client.listCollections(this.databaseInfo.name);
        return collections.map((collection) => {
            return new CollectionItem(this.subscription, this.mongoCluster, this.databaseInfo, collection);
        });
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            label: this.databaseInfo.name,
            iconPath: new ThemeIcon('database'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
