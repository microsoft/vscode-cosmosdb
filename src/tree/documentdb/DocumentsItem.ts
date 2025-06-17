/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ThemeIcon, type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type ClusterModel } from './ClusterModel';
import { type CollectionItem } from './CollectionItem';

export class DocumentsItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem.documents';

    private readonly experienceContextValue: string = '';

    /**
     * @param cluster
     * @param databaseInfo
     * @param collectionInfo
     * @param parentCollectionNode  Using the `parentCollectionNode` here is an exception to our approach where the parent information is not
     *                              tracked. Typically, model information is sufficient to get every action completed.
     *                              However, here, we added the parent (the collection node) so that we can execute a command that requires
     *                              the collection node to be passed in. This is a workaround that reduces complex changes to the commands used.
     */
    constructor(
        readonly cluster: ClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        readonly parentCollectionNode: CollectionItem,
    ) {
        this.id = `${cluster.id}/${databaseInfo.name}/${collectionInfo.name}/documents`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience.${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Documents'),
            command: {
                title: l10n.t('Open Collection'), // unused, but required by TreeItem
                command: 'command.internal.mongoClusters.containerView.open',
                arguments: [
                    {
                        id: this.id,
                        viewTitle: `${this.collectionInfo.name}`,
                        // viewTitle: `${this.mongoCluster.name}/${this.databaseInfo.name}/${this.collectionInfo.name}`, // using '/' as a separator to use VSCode's "title compression"(?) feature

                        clusterId: this.cluster.id,
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
