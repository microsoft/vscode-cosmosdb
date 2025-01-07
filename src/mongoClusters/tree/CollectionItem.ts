/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createContextValue,
    createGenericElement,
    type IActionContext,
    type TreeElementBase,
    type TreeElementWithId
} from '@microsoft/vscode-azext-utils';
import { type Document } from 'bson';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import {
    MongoClustersClient,
    type CollectionItemModel,
    type DatabaseItemModel,
    type InsertDocumentsResult,
} from '../MongoClustersClient';
import { IndexesItem } from './IndexesItem';
import { type MongoClusterModel } from './MongoClusterModel';

export class CollectionItem implements TreeElementWithId {
    id: string;
    experience?: Experience;

    constructor(
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}/${collectionInfo.name}`;
        this.experience = mongoCluster.dbExperience;
    }

    async getChildren(): Promise<TreeElementBase[]> {
        return [
            createGenericElement({
                contextValue: createContextValue(['treeitem.documents', this.mongoCluster.dbExperience?.api ?? '']),
                id: `${this.id}/documents`,
                label: 'Documents',
                commandId: 'command.internal.mongoClusters.containerView.open',
                commandArgs: [
                    {
                        id: this.id,
                        viewTitle: `${this.collectionInfo.name}`,
                        // viewTitle: `${this.mongoCluster.name}/${this.databaseInfo.name}/${this.collectionInfo.name}`, // using '/' as a separator to use VSCode's "title compression"(?) feature

                        clusterId: this.mongoCluster.id,
                        databaseName: this.databaseInfo.name,
                        collectionName: this.collectionInfo.name,
                        collectionTreeItem: this,
                    },
                ],
                iconPath: new ThemeIcon('explorer-view-icon'),
            }),
            new IndexesItem(this.mongoCluster, this.databaseInfo, this.collectionInfo),
            createGenericElement({
                contextValue: createContextValue(['treeitem.documents', this.mongoCluster.dbExperience?.api ?? '']),
                id: `${this.id}/documents/asdf`,
                label: 'aa' + new Date().toLocaleTimeString(),
                iconPath: new ThemeIcon('explorer-view-icon'),
            }),
        ];
    }

    async delete(_context: IActionContext): Promise<boolean> {
        const client = await MongoClustersClient.getClient(this.mongoCluster.id);

        let success = false;
        await ext.state.showDeleting(this.id, async () => {
            success = await client.dropCollection(this.databaseInfo.name, this.collectionInfo.name);
        });

        ext.state.notifyChildrenChanged(`${this.mongoCluster.id}/${this.databaseInfo.name}`);

        return success;
    }

    async insertDocuments(_context: IActionContext, documents: Document[]): Promise<InsertDocumentsResult> {
        const client = await MongoClustersClient.getClient(this.mongoCluster.id);

        let result: InsertDocumentsResult = { acknowledged: false, insertedCount: 0 };

        await ext.state.runWithTemporaryDescription(this.id, 'Importing...', async () => {
            result = await client.insertDocuments(this.databaseInfo.name, this.collectionInfo.name, documents);
        });

        return result;
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: createContextValue(['treeitem.collection', this.mongoCluster.dbExperience?.api ?? '']),
            label: this.collectionInfo.name,
            iconPath: new ThemeIcon('folder-opened'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
