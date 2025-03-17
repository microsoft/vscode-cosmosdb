/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import { ThemeIcon, type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../../tree/CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { type CollectionItemModel, type DatabaseItemModel } from '../MongoClustersClient';
import { type CollectionItem } from './CollectionItem';
import { type MongoClusterModel } from './MongoClusterModel';

export class DocumentsItem implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public readonly contextValue: string = 'treeItem.documents';

    private readonly experienceContextValue: string = '';

    /**
     * @param mongoCluster
     * @param databaseInfo
     * @param collectionInfo
     * @param parentCollectionNode  Using the `parentCollectionNode` here is an exception to our approach where the parent information is not
     *                              tracked. Typically, model information is sufficient to get every action completed.
     *                              However, here, we added the parent (the collection node) so that we can execute a command that requires
     *                              the collection node to be passed in. This is a workaround that reduces complex changes to the commands used.
     */
    constructor(
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        readonly parentCollectionNode: CollectionItem,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}/${collectionInfo.name}/documents`;
        this.experience = mongoCluster.dbExperience;
        this.experienceContextValue = `experience.${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: 'Documents',
            command: {
                title: 'Open Collection', // unused, but required by TreeItem
                command: 'command.internal.mongoClusters.containerView.open',
                arguments: [
                    {
                        id: this.id,
                        viewTitle: `${this.collectionInfo.name}`,
                        // viewTitle: `${this.mongoCluster.name}/${this.databaseInfo.name}/${this.collectionInfo.name}`, // using '/' as a separator to use VSCode's "title compression"(?) feature

                        clusterId: this.mongoCluster.id,
                        databaseName: this.databaseInfo.name,
                        collectionName: this.collectionInfo.name,
                        collectionTreeItem: this.parentCollectionNode,
                    },
                ],
            },
            iconPath: new ThemeIcon('explorer-view-icon'),
        };
    }
}
