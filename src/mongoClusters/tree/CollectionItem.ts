/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import { ThemeIcon, type TreeItem, TreeItemCollapsibleState } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../../tree/CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { type CollectionItemModel, type DatabaseItemModel } from '../MongoClustersClient';
import { IndexesItem } from './IndexesItem';
import { type MongoClusterModel } from './MongoClusterModel';

export class CollectionItem implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public readonly contextValue: string = 'treeItem.collection';

    private readonly experienceContextValue: string = '';

    constructor(
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}/${collectionInfo.name}`;
        this.experience = mongoCluster.dbExperience;
        this.experienceContextValue = `experience.${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        return [
            createGenericElement({
                contextValue: createContextValue(['treeItem.documents', this.experienceContextValue]),
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
            }) as CosmosDBTreeElement,
            new IndexesItem(this.mongoCluster, this.databaseInfo, this.collectionInfo),
        ];
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.collectionInfo.name,
            iconPath: new ThemeIcon('folder-opened'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
