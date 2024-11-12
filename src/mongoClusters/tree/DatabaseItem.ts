/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGenericElement, type IActionContext, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { MongoClustersClient, type DatabaseItemModel } from '../MongoClustersClient';
import { CollectionItem } from './CollectionItem';
import { type MongoClusterModel } from './MongoClusterModel';

export class DatabaseItem {
    id: string;

    constructor(
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}`;
    }

    async getChildren(): Promise<TreeElementBase[]> {
        const client: MongoClustersClient = await MongoClustersClient.getClient(this.mongoCluster.id);
        const collections = await client.listCollections(this.databaseInfo.name);

        if (collections.length === 0) {
            // no databases in there:
            return [
                createGenericElement({
                    contextValue: 'mongoClusters.item.no-collection',
                    id: `${this.id}/no-databases`,
                    label: 'Create collection...',
                    iconPath: new vscode.ThemeIcon('plus'),
                    commandId: 'mongoClusters.cmd.createCollection',
                    commandArgs: [this],
                }),
            ];
        }

        return collections.map((collection) => {
            return new CollectionItem(this.mongoCluster, this.databaseInfo, collection);
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
