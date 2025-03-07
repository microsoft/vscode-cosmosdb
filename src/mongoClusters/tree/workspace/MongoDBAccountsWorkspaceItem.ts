/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { MongoClustersExperience, type Experience } from '../../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../../../tree/CosmosDBTreeElement';
import { type TreeElementWithExperience } from '../../../tree/TreeElementWithExperience';
import { WorkspaceResourceType } from '../../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../../tree/workspace-api/SharedWorkspaceStorage';
import { type MongoClusterModel } from '../MongoClusterModel';
import { LocalMongoEmulatorsItem } from './LocalEmulators/LocalMongoEmulatorsItem';
import { MongoClusterWorkspaceItem } from './MongoClusterWorkspaceItem';
import { MongoDBAttachAccountResourceItem } from './MongoDBAttachAccountResourceItem';

export class MongoDBAccountsWorkspaceItem implements CosmosDBTreeElement, TreeElementWithExperience {
    public readonly id: string;
    public readonly experience: Experience;

    constructor() {
        this.id = `vscode.cosmosdb.workspace.mongoclusters.accounts`;
        this.experience = MongoClustersExperience;
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        const allItems = await SharedWorkspaceStorage.getItems(WorkspaceResourceType.MongoClusters);

        return [
            new LocalMongoEmulatorsItem(this.id),
            ...allItems
                .filter((item) => !item.properties?.isEmulator) // filter out emulators
                .map((item) => {
                    const model: MongoClusterModel = {
                        id: item.id,
                        name: item.name,
                        dbExperience: MongoClustersExperience,
                        connectionString: item?.secrets?.[0] ?? undefined,
                    };

                    return new MongoClusterWorkspaceItem(model);
                }),
            new MongoDBAttachAccountResourceItem(this.id),
        ];
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: 'vscode.cosmosdb.workspace.mongoclusters.accounts',
            label: 'MongoDB Accounts',
            iconPath: new vscode.ThemeIcon('link'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
