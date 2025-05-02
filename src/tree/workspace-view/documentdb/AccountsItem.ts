/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { MongoClustersExperience, type Experience } from '../../../AzureDBExperiences';
import { StorageNames, StorageService } from '../../../services/storageService';
import { generateMongoStorageId } from '../../../utils/storageUtils'; // Import the new utility function
import { type AttachedClusterModel } from '../../documentdb/ClusterModel';
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
        this.id = `${WorkspaceResourceType.MongoClusters}`;
        this.experience = MongoClustersExperience;
    }

    async getChildren(): Promise<TreeElement[]> {
        const allItems = await StorageService.get(StorageNames.Workspace).getItems(WorkspaceResourceType.MongoClusters);

        // TODO: remove this in a couple of releases
        // If we find any items that are not in the new storage format,
        // we need to migrate them to stay consistent
        const itemUpdates = new Map<string, string>(); // original ID -> new ID
        await Promise.allSettled(
            allItems
                // filter out emulators
                .filter((item) => !item.properties?.isEmulator)
                // only work on items in the old format
                .filter((item) => !item.id.startsWith('storageId-'))
                // convert them to the new format and return the modified items
                .map(async (item) => {
                    try {
                        const originalId = item.id;
                        const connectionString = item.secrets?.[0];

                        if (!connectionString) {
                            console.warn(`Item ${originalId} has no connection string, skipping migration`);
                            return;
                        }

                        const storageId = generateMongoStorageId(connectionString);

                        // Create the new item with updated ID
                        const newItem = { ...item, id: storageId };

                        // Save new item first for safety
                        await StorageService.get(StorageNames.Workspace).push(
                            WorkspaceResourceType.MongoClusters,
                            newItem,
                            true,
                        );

                        // Delete old item after successful save
                        await StorageService.get(StorageNames.Workspace).delete(
                            WorkspaceResourceType.MongoClusters,
                            originalId,
                        );

                        // Track this item for in-memory update
                        itemUpdates.set(originalId, storageId);
                    } catch (error) {
                        console.error(`Failed to migrate item ${item.id}`, error);
                    }
                }),
        );

        // EXPLICIT SIDE EFFECT: Update the in-memory items to match storage changes
        if (itemUpdates.size > 0) {
            console.log(`Updating ${itemUpdates.size} in-memory items with new IDs`);
            for (const item of allItems) {
                const newId = itemUpdates.get(item.id);
                if (newId) {
                    item.id = newId; // Explicit side effect, updating allItems in-memory
                }
            }
        }

        return [
            new LocalEmulatorsItem(this.id),
            ...allItems
                .filter((item) => !item.properties?.isEmulator) // filter out emulators
                .map((item) => {
                    const model: AttachedClusterModel = {
                        id: `${this.id}/${item.id}`, // To enable TreeView.reveal, we need to have a unique nested id
                        storageId: item.id,
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
