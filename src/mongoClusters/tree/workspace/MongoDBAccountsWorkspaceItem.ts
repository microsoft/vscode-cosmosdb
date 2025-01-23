/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGenericElement } from '@microsoft/vscode-azext-utils';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { MongoClustersExprience, type Experience } from '../../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../../../tree/CosmosDBTreeElement';
import { type TreeElementWithExperience } from '../../../tree/TreeElementWithExperience';
import { WorkspaceResourceType } from '../../../tree/workspace/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../../tree/workspace/SharedWorkspaceStorage';
import { type MongoClusterModel } from '../MongoClusterModel';
import { MongoClusterWorkspaceItem } from './MongoClusterWorkspaceItem';

export class MongoDBAccountsWorkspaceItem implements CosmosDBTreeElement, TreeElementWithExperience {
    id: string;
    experience?: Experience;

    constructor() {
        this.id = `vscode.cosmosdb.workspace.mongoclusters.accounts`;
        this.experience = MongoClustersExprience;
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        const items = await SharedWorkspaceStorage.getItems(WorkspaceResourceType.MongoClusters);

        return [
            ...items.map((item) => {
                const model: MongoClusterModel = {
                    id: item.id,
                    name: item.name,
                    dbExperience: MongoClustersExprience,
                    connectionString: item?.secrets?.[0] ?? undefined,
                };
                return new MongoClusterWorkspaceItem(model);
            }),
            createGenericElement({
                contextValue: 'treeItem.newConnection',
                id: this.id + '/newConnection',
                label: 'New Connection...',
                iconPath: new ThemeIcon('plus'),
                commandId: 'command.mongoClusters.addWorkspaceConnection',
            }) as CosmosDBTreeElement,
        ];
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: 'vscode.cosmosdb.workspace.mongoclusters.accounts',
            label: 'MongoDB Cluster Accounts',
            iconPath: new ThemeIcon('link'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
