/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, getExperienceFromApi } from '../../../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../../../constants';
import { type StorageItem, StorageNames, StorageService } from '../../../../services/storageService';
import { migrateRawEmulatorItemToHashed } from '../../../../utils/emulatorUtils';
import { NoSqlAccountAttachedResourceItem } from '../../../nosql/NoSqlAccountAttachedResourceItem';
import { type TreeElement } from '../../../TreeElement';
import { type TreeElementWithContextValue } from '../../../TreeElementWithContextValue';
import { WorkspaceResourceType } from '../../../workspace-api/SharedWorkspaceResourceProvider';
import { type CosmosDBAttachedAccountModel } from '../CosmosDBAttachedAccountModel';
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
                    .filter((item) => item.properties?.isEmulator) // only show emulators
                    .map(async (item) => {
                        const { id, name, properties, secrets } = await migrateRawEmulatorItemToHashed(item);
                        const api: API = nonNullValue(properties?.api, 'api') as API;
                        const isEmulator: boolean = !!nonNullValue(properties?.isEmulator, 'isEmulator');
                        const connectionString: string = nonNullValue(secrets?.[0], 'connectionString');
                        const experience = getExperienceFromApi(api);
                        const accountModel: CosmosDBAttachedAccountModel = {
                            id: `${this.id}/${id}`, // To enable TreeView.reveal, we need to have a unique nested id
                            storageId: id,
                            name,
                            connectionString,
                            isEmulator,
                        };

                        if (experience?.api === API.Core) {
                            return new NoSqlAccountAttachedResourceItem(accountModel, experience);
                        }

                        // Unknown experience
                        return undefined;
                    }),
            )
        ).filter((item) => item !== undefined); // Explicitly filter out undefined values
    }
}
