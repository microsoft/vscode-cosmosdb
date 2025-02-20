/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { TreeItemCollapsibleState } from 'vscode';
import { MongoClustersExperience } from '../../../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../../../constants';
import { type CosmosDBTreeElement } from '../../../../tree/CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../../../../tree/TreeElementWithContextValue';
import { WorkspaceResourceType } from '../../../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../../../tree/workspace-api/SharedWorkspaceStorage';
import { type MongoClusterModel } from '../../MongoClusterModel';
import { MongoClusterWorkspaceItem } from '../MongoClusterWorkspaceItem';
import { NewMongoEmulatorConnectionItem } from './NewMongoEmulatorConnectionItem';
import { type MongoEmulatorConfiguration } from '../../../newConnection/MongoEmulatorConfiguration';

export class LocalMongoEmulatorsItem implements CosmosDBTreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.newConnection';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/localEmulators`;
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        const allItems = await SharedWorkspaceStorage.getItems(WorkspaceResourceType.MongoClusters);
        return [
            ...allItems
                .filter((item) => item.properties?.isEmulator) // only show emulators
                .map((item) => {
                    const emulatorConfiguration: MongoEmulatorConfiguration = {
                        isEmulator: true,
                        disableEmulatorSecurity: !!item.properties?.disableEmulatorSecurity,
                    };

                    const model: MongoClusterModel = {
                        id: item.id,
                        name: item.name,
                        dbExperience: MongoClustersExperience,
                        connectionString: item?.secrets?.[0],
                        emulatorConfiguration: emulatorConfiguration,
                    };

                    return new MongoClusterWorkspaceItem(model);
                }),
            new NewMongoEmulatorConnectionItem(this.id),
        ];
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: 'Local Emulators',
            iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
