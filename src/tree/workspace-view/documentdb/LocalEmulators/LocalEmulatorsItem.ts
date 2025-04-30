/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { MongoClustersExperience } from '../../../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../../../constants';
import { StorageNames, StorageService } from '../../../../services/storageService';
import { type EmulatorConfiguration } from '../../../../utils/emulatorConfiguration';
import { migrateRawEmulatorItemToHashed } from '../../../../utils/emulatorUtils';
import { type AttachedClusterModel } from '../../../documentdb/ClusterModel';
import { type TreeElement } from '../../../TreeElement';
import { type TreeElementWithContextValue } from '../../../TreeElementWithContextValue';
import { WorkspaceResourceType } from '../../../workspace-api/SharedWorkspaceResourceProvider';
import { ClusterItem } from '../ClusterItem';
import { NewEmulatorConnectionItem } from './NewEmulatorConnectionItem';

export class LocalEmulatorsItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.newConnection';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/localEmulators`;
    }

    async getChildren(): Promise<TreeElement[]> {
        const allItems = await StorageService.get(StorageNames.Workspace).getItems(WorkspaceResourceType.MongoClusters);
        const results = (
            await Promise.all(
                allItems
                    .filter((item) => item.properties?.isEmulator) // only show emulators
                    .map(async (item) => {
                        const { id, name, properties, secrets } = await migrateRawEmulatorItemToHashed(item);
                        // we need to create the emulator configuration object from
                        // the flat properties object
                        const emulatorConfiguration: EmulatorConfiguration = {
                            isEmulator: true,
                            disableEmulatorSecurity: !!properties?.disableEmulatorSecurity,
                        };

                        const model: AttachedClusterModel = {
                            id: `${this.id}/${id}`, // To enable TreeView.reveal, we need to have a unique nested id
                            storageId: id,
                            name,
                            dbExperience: MongoClustersExperience,
                            connectionString: secrets?.[0],
                            emulatorConfiguration: emulatorConfiguration,
                        };

                        return new ClusterItem(model);
                    }),
            )
        ).filter((item) => item !== undefined); // Explicitly filter out undefined values

        return [...results, new NewEmulatorConnectionItem(this.id)];
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Local Emulators'),
            iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
