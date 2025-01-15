/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createContextValue,
    createGenericElement,
    type TreeElementBase,
    type TreeElementWithId,
} from '@microsoft/vscode-azext-utils';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { API, type Experience } from '../../AzureDBExperiences';
import { type TreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { type CollectionItemModel, type DatabaseItemModel, type IndexItemModel } from '../MongoClustersClient';
import { type MongoClusterModel } from './MongoClusterModel';

export class IndexItem implements TreeElementWithId, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience?: Experience;
    public readonly contextValue: string = 'treeItem.index';

    private readonly experienceContextValue: string = '';

    constructor(
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        readonly indexInfo: IndexItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}/${collectionInfo.name}/indexes/${indexInfo.name}`;
        this.experience = mongoCluster.dbExperience;
        this.experienceContextValue = `experience.${this.experience?.api ?? API.Common}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
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
            contextValue: this.contextValue,
            label: this.indexInfo.name,
            iconPath: new ThemeIcon('combine'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
