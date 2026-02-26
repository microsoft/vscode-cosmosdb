/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { StorageNames, StorageService } from '../../../services/StorageService';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { WorkspaceResourceType } from '../../workspace-api/SharedWorkspaceResourceProvider';
import { MigrationItem, type MigrationModel } from './MigrationItem';
import { NewMigrationItem } from './NewMigrationItem';

export const MIGRATIONS_STORAGE_KEY = 'ms-azuretools.vscode-cosmosdb.migrations';

export class MigrationWorkspaceItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string = `${WorkspaceResourceType.Migrations}`;
    public readonly contextValue: string = 'treeItem.migrations';

    public async getChildren(): Promise<TreeElement[]> {
        const items = await StorageService.get(StorageNames.Workspace).getItems(MIGRATIONS_STORAGE_KEY);

        const children: TreeElement[] = items.map((item) => {
            const model: MigrationModel = {
                id: `${this.id}/${item.id}`,
                storageId: item.id,
                name: item.name,
                migrationPath: (item.properties?.migrationPath as string) ?? '',
            };
            return new MigrationItem(model);
        });

        children.push(new NewMigrationItem(this.id));
        return children;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Cosmos DB Migrations'),
            iconPath: new vscode.ThemeIcon('arrow-swap'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    /**
     * Add a migration entry to the workspace storage.
     * If an entry with the same path already exists, it is renamed instead of creating a duplicate.
     */
    static async addMigration(name: string, migrationPath: string): Promise<void> {
        const storage = StorageService.get(StorageNames.Workspace);
        const items = await storage.getItems(MIGRATIONS_STORAGE_KEY);

        const existing = items.find((item) => (item.properties?.migrationPath as string) === migrationPath);
        if (existing) {
            if (existing.name !== name) {
                existing.name = name;
                await storage.push(MIGRATIONS_STORAGE_KEY, existing);
            }
            return;
        }

        const id = `migration-${Date.now()}`;
        await storage.push(MIGRATIONS_STORAGE_KEY, {
            id,
            name,
            properties: { migrationPath },
        });
    }

    /**
     * Remove a migration entry from the workspace storage.
     */
    static async removeMigration(storageId: string): Promise<void> {
        const storage = StorageService.get(StorageNames.Workspace);
        await storage.delete(MIGRATIONS_STORAGE_KEY, storageId);
    }
}
