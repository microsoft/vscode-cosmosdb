/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { API, type Experience } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { type CosmosDBTreeElement } from '../../tree/CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { localize } from '../../utils/localize';
import { MongoClustersClient, type DatabaseItemModel } from '../MongoClustersClient';
import { CollectionItem } from './CollectionItem';
import { type MongoClusterModel } from './MongoClusterModel';

export class DatabaseItem implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience?: Experience;
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
                    label: 'Create collection...',
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

    async delete(_context: IActionContext): Promise<boolean> {
        const client = await MongoClustersClient.getClient(this.mongoCluster.id);

        let success = false;
        await ext.state.showDeleting(this.id, async () => {
            success = await client.dropDatabase(this.databaseInfo.name);
        });

        ext.state.notifyChildrenChanged(this.mongoCluster.id);

        return success;
    }

    async createCollection(_context: IActionContext, collectionName: string): Promise<boolean> {
        const client = await MongoClustersClient.getClient(this.mongoCluster.id);

        return ext.state.showCreatingChild(
            this.id,
            localize('mongoClusters.tree.creating', 'Creating "{0}"...', collectionName),
            async () => {
                // Adding a delay to ensure the "creating child" animation is visible.
                // The `showCreatingChild` function refreshes the parent to show the
                // "creating child" animation and label. Refreshing the parent triggers its
                // `getChildren` method. If the database creation completes too quickly,
                // the dummy node with the animation might be shown alongside the actual
                // database entry, as it will already be available in the database.
                // Note to future maintainers: Do not remove this delay.
                await new Promise((resolve) => setTimeout(resolve, 250));
                return client.createCollection(this.databaseInfo.name, collectionName);
            },
        );
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.databaseInfo.name,
            iconPath: new ThemeIcon('database'), // TODO: create our own icon here, this one's shape can change
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
