/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, getExperienceFromApi } from '../../../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../../../constants';
import { wellKnownEmulatorPassword } from '../../../../cosmosdb/cosmosdb-shared-constants';
import { type StorageItem, StorageNames, StorageService } from '../../../../services/StorageService';
import { migrateRawEmulatorItemToHashed } from '../../../../utils/emulatorUtils';
import { makeFilterable } from '../../../mixins/Filterable';
import { makeSortable } from '../../../mixins/Sortable';
import { NoSqlAccountAttachedResourceItem } from '../../../nosql/NoSqlAccountAttachedResourceItem';
import { type TreeElement } from '../../../TreeElement';
import { type TreeElementWithContextValue } from '../../../TreeElementWithContextValue';
import { WorkspaceResourceType } from '../../../workspace-api/SharedWorkspaceResourceProvider';
import { type CosmosDBAttachedAccountModel } from '../CosmosDBAttachedAccountModel';
import { getSavedConnectionError, InvalidConnectionResourceItem } from '../InvalidConnectionResourceItem';
import { NewCoreEmulatorConnectionItem } from './NewCoreEmulatorConnectionItem';

export class LocalCoreEmulatorsItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.newConnection';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/localEmulators`;
    }

    async getChildren(): Promise<TreeElement[]> {
        const allItems = await StorageService.get(StorageNames.Workspace).getItems(
            WorkspaceResourceType.AttachedAccounts,
        );

        const children = await this.getChildrenEmulatorOnlyImpl(allItems);

        return [...children, new NewCoreEmulatorConnectionItem(this.id)];
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

    protected async getChildrenEmulatorOnlyImpl(items: StorageItem[]): Promise<TreeElement[]> {
        return (
            await Promise.all(
                items
                    .filter((item) => item.properties?.isEmulator === true) // only show emulators
                    .map(async (item) => {
                        const validationError = getSavedConnectionError(item);
                        if (validationError) {
                            return new InvalidConnectionResourceItem(this.id, item, validationError);
                        }

                        // Migration rewrites the record and deletes the original, so records owned by another
                        // experience have to be skipped before storage is touched.
                        const experience = getExperienceFromApi(item.properties?.api as API);
                        if (experience.api !== API.Core) {
                            return undefined;
                        }

                        try {
                            const { id, name, secrets } = await migrateRawEmulatorItemToHashed(item);
                            const isEmulator = true;

                            // Use stored connection string, or fallback to default emulator connection string
                            const connectionString: string =
                                secrets?.[0] ||
                                `AccountEndpoint=https://localhost:8081/;AccountKey=${wellKnownEmulatorPassword};`;

                            const accountModel: CosmosDBAttachedAccountModel = {
                                id: `${this.id}/${id}`, // To enable TreeView.reveal, we need to have a unique nested id
                                storageId: id,
                                name,
                                connectionString,
                                isEmulator,
                            };

                            return makeFilterable(
                                makeSortable(new NoSqlAccountAttachedResourceItem(accountModel, experience)),
                            );
                        } catch {
                            return new InvalidConnectionResourceItem(
                                this.id,
                                item,
                                l10n.t('Unable to load the saved emulator connection.'),
                            );
                        }
                    }),
            )
        ).filter((item) => item !== undefined); // Explicitly filter out undefined values
    }
}
