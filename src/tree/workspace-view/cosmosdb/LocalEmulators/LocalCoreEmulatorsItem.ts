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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return Promise.resolve(
            items
                .filter((item) => item.properties?.isEmulator) // only show emulators
                .map((item) => {
                    const { id, name, properties, secrets } = item;
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const api: API = nonNullValue(properties?.api, 'api') as API;
                    const isEmulator: boolean = !!nonNullValue(properties?.isEmulator, 'isEmulator');
                    const connectionString: string = nonNullValue(secrets?.[0], 'connectionString');
                    const experience = getExperienceFromApi(api);
                    const accountModel: CosmosDBAttachedAccountModel = {
                        id,
                        name,
                        connectionString,
                        isEmulator,
                    };

                    if (experience?.api === API.Core) {
                        return new NoSqlAccountAttachedResourceItem(accountModel, experience);
                    }

                    // Unknown experience
                    return undefined;
                })
                .filter((r) => r !== undefined),
        );
    }
}
