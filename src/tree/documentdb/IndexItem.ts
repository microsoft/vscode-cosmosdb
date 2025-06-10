/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CollectionItemModel, type DatabaseItemModel, type IndexItemModel } from '../../documentdb/ClustersClient';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type ClusterModel } from './ClusterModel';

export class IndexItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem.index';

    private readonly experienceContextValue: string = '';

    constructor(
        readonly cluster: ClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        readonly indexInfo: IndexItemModel,
    ) {
        this.id = `${cluster.id}/${databaseInfo.name}/${collectionInfo.name}/indexes/${indexInfo.name}`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience.${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    async getChildren(): Promise<TreeElement[]> {
        return Object.keys(this.indexInfo.key).map((key) => {
            const value = this.indexInfo.key[key];

            return createGenericElement({
                contextValue: key,
                id: `${this.id}/${key}`,
                label: key,
                // TODO: add a custom icons, and more options here
                description: value === -1 ? 'desc' : value === 1 ? 'asc' : value.toString(),
                iconPath: new vscode.ThemeIcon('combine'),
            }) as TreeElement;
        });
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.indexInfo.name,
            iconPath: new vscode.ThemeIcon('combine'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
