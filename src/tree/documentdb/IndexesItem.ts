/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { ClustersClient, type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type ClusterModel } from './ClusterModel';
import { IndexItem } from './IndexItem';

export class IndexesItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem.indexes';

    private readonly experienceContextValue: string = '';

    constructor(
        readonly cluster: ClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
    ) {
        this.id = `${cluster.id}/${databaseInfo.name}/${collectionInfo.name}/indexes`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience.${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    async getChildren(): Promise<TreeElement[]> {
        const client: ClustersClient = await ClustersClient.getClient(this.cluster.id);
        const indexes = await client.listIndexes(this.databaseInfo.name, this.collectionInfo.name);
        return indexes.map((index) => {
            return new IndexItem(this.cluster, this.databaseInfo, this.collectionInfo, index);
        });
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Indexes'),
            iconPath: new vscode.ThemeIcon('combine'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
