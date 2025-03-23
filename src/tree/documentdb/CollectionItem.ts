/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type ClusterModel } from './ClusterModel';
import { DocumentsItem } from './DocumentsItem';
import { IndexesItem } from './IndexesItem';

export class CollectionItem implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public readonly contextValue: string = 'treeItem.collection';

    private readonly experienceContextValue: string = '';

    constructor(
        readonly mongoCluster: ClusterModel,
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
            new DocumentsItem(this.mongoCluster, this.databaseInfo, this.collectionInfo, this),
            new IndexesItem(this.mongoCluster, this.databaseInfo, this.collectionInfo),
        ];
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.collectionInfo.name,
            iconPath: new vscode.ThemeIcon('folder-opened'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
