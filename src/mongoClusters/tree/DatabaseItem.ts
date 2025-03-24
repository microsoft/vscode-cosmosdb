/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../../tree/CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { MongoClustersClient, type DatabaseItemModel } from '../MongoClustersClient';
import { CollectionItem } from './CollectionItem';
import { type MongoClusterModel } from './MongoClusterModel';

export class DatabaseItem implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public readonly contextValue: string = 'treeItem.database';

    private readonly experienceContextValue: string = '';

    constructor(
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}`;
        this.experience = mongoCluster.dbExperience;
        this.experienceContextValue = `experience.${this.experience?.api ?? API.Common}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        const client: MongoClustersClient = await MongoClustersClient.getClient(this.mongoCluster.id);
        const collections = await client.listCollections(this.databaseInfo.name);

        if (collections.length === 0) {
            // no databases in there:
            return [
                createGenericElement({
                    contextValue: createContextValue(['treeItem.no-collections', this.experienceContextValue]),
                    id: `${this.id}/no-collections`,
                    label: l10n.t('Create Collection…'),
                    iconPath: new vscode.ThemeIcon('plus'),
                    commandId: 'command.mongoClusters.createCollection',
                    commandArgs: [this],
                }) as CosmosDBTreeElement,
            ];
        }

        return collections.map((collection) => {
            return new CollectionItem(this.mongoCluster, this.databaseInfo, collection);
        });
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.databaseInfo.name,
            iconPath: new vscode.ThemeIcon('database'), // TODO: create our own icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
