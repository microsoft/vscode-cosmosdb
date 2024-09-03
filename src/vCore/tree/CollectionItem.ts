import { createGenericElement, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { type CollectionItemModel, type DatabaseItemModel } from '../VCoreClient';
import { type MongoClusterItemBase, type MongoClusterModel } from './MongoClusterItem';

export class CollectionItem implements MongoClusterItemBase {
    id: string;

    constructor(
        readonly subscription: AzureSubscription,
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}/${collectionInfo.name}`;
    }

    async getChildren(): Promise<TreeElementBase[]> {
        return [
            createGenericElement({
                contextValue: 'documents',
                id: `${this.id}/documents`,
                label: 'Documents',
                commandId: 'mongocluster.internal.containerView.open',
                commandArgs: [
                    {
                        id: this.id,
                        viewTitle: `${this.collectionInfo.name}`,
                        // viewTitle: `${this.mongoCluster.name}/${this.databaseInfo.name}/${this.collectionInfo.name}`, // using '/' as a separator to use VSCode's "title compression"(?) feature

                        liveConnectionId: this.mongoCluster.session?.clientId,
                        databaseName: this.databaseInfo.name,
                        collectionName: this.collectionInfo.name,
                    },
                ],
                iconPath: new ThemeIcon('explorer-view-icon'),
            }),
            createGenericElement({
                contextValue: 'index',
                id: `${this.id}/index`,
                label: 'Index',
                description: 'coming soon',
                iconPath: new ThemeIcon('combine'),
            }),
        ];
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            label: this.collectionInfo.name,
            iconPath: new ThemeIcon('folder-opened'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}