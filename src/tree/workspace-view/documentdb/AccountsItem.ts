/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { MongoClustersExperience, type Experience } from '../../../AzureDBExperiences';
import { StorageNames, StorageService } from '../../../services/storageService';
import { type ClusterModel } from '../../documentdb/ClusterModel';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithExperience } from '../../TreeElementWithExperience';
import { WorkspaceResourceType } from '../../workspace-api/SharedWorkspaceResourceProvider';
import { ClusterItem } from './ClusterItem';
import { LocalEmulatorsItem } from './LocalEmulators/LocalEmulatorsItem';
import { NewConnectionItem } from './NewConnectionItem';

export class AccountsItem implements TreeElement, TreeElementWithExperience {
    public readonly id: string;
    public readonly experience: Experience;

    constructor() {
        this.id = 'vscode.cosmosdb.workspace.mongoclusters.accounts';
        this.experience = MongoClustersExperience;
    }

    async getChildren(): Promise<TreeElement[]> {
        const allItems = await StorageService.get(StorageNames.Workspace).getItems(WorkspaceResourceType.MongoClusters);

        return [
            new LocalEmulatorsItem(this.id),
            ...allItems
                .filter((item) => !item.properties?.isEmulator) // filter out emulators
                .map((item) => {
                    const model: ClusterModel = {
                        id: item.id,
                        name: item.name,
                        dbExperience: MongoClustersExperience,
                        connectionString: item?.secrets?.[0] ?? undefined,
                    };

                    return new ClusterItem(model);
                }),
            new NewConnectionItem(this.id),
        ];
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: 'vscode.cosmosdb.workspace.mongoclusters.accounts',
            label: l10n.t('MongoDB Accounts'),
            iconPath: new vscode.ThemeIcon('link'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
