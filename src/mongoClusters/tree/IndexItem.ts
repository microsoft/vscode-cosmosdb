/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { type CollectionItemModel, type DatabaseItemModel, type IndexItemModel } from '../MongoClustersClient';
import { type MongoClusterModel } from './MongoClusterModel';

export class IndexItem {
    id: string;

    constructor(
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        readonly indexInfo: IndexItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}/${collectionInfo.name}/indexes/${indexInfo.name}`;
    }

    async getChildren(): Promise<TreeElementBase[]> {
        return Object.keys(this.indexInfo.key).map((key) => {
            const value = this.indexInfo.key[key];

            return createGenericElement({
                contextValue: key,
                id: `${this.id}/${key}`,
                label: key,
                // TODO: add a custom icons, and more options here
                description: value === -1 ? 'desc' : value === 1 ? 'asc' : value.toString(),
                iconPath: new ThemeIcon('combine'),
            });
        });
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: createContextValue(['treeitem.index', this.mongoCluster.dbExperience?.api ?? '']),
            label: this.indexInfo.name,
            iconPath: new ThemeIcon('combine'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
