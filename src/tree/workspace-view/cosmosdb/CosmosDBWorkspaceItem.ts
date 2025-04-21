/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, nonNullValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, getExperienceFromApi } from '../../../AzureDBExperiences';
import { isEmulatorSupported } from '../../../constants';
import { type StorageItem, StorageNames, StorageService } from '../../../services/storageService';
import { GraphAccountAttachedResourceItem } from '../../graph/GraphAccountAttachedResourceItem';
import { NoSqlAccountAttachedResourceItem } from '../../nosql/NoSqlAccountAttachedResourceItem';
import { TableAccountAttachedResourceItem } from '../../table/TableAccountAttachedResourceItem';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { WorkspaceResourceType } from '../../workspace-api/SharedWorkspaceResourceProvider';
import { pickSupportedAccounts, postPickSupportedAccountsCleanUp } from '../accountMigration';
import { CosmosDBAttachAccountResourceItem } from './CosmosDBAttachAccountResourceItem';
import { type CosmosDBAttachedAccountModel } from './CosmosDBAttachedAccountModel';
import { LocalCoreEmulatorsItem } from './LocalEmulators/LocalCoreEmulatorsItem';

export class CosmosDBWorkspaceItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string = WorkspaceResourceType.AttachedAccounts;
    public readonly contextValue: string = 'treeItem.accounts';

    constructor() {
        this.contextValue = createContextValue([this.contextValue, `attachedAccounts`]);
    }

    public async getChildren(): Promise<TreeElement[]> {
        // TODO: remove `pickSupportedAccounts` and `postPickSupportedAccountsCleanUp` after a few releases
        await pickSupportedAccounts(); // Move accounts from the old storage format to the new one
        await postPickSupportedAccountsCleanUp(); // Fixes https://github.com/microsoft/vscode-cosmosdb/issues/2649

        const items = await StorageService.get(StorageNames.Workspace).getItems(this.id);
        const children = await this.getChildrenNoEmulatorsImpl(items);

        if (isEmulatorSupported) {
            return [new LocalCoreEmulatorsItem(this.id), ...children, new CosmosDBAttachAccountResourceItem(this.id)];
        } else {
            return [...children, new CosmosDBAttachAccountResourceItem(this.id)];
        }
    }

    public getTreeItem() {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('CosmosDB Accounts'),
            iconPath: new vscode.ThemeIcon('plug'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected async getChildrenNoEmulatorsImpl(items: StorageItem[]): Promise<TreeElement[]> {
        return Promise.resolve(
            items
                .filter((item) => item.properties?.isEmulator !== true)
                .map((item) => {
                    const { id, name, properties, secrets } = item;
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

                    if (experience?.api === API.Cassandra) {
                        return new NoSqlAccountAttachedResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Core) {
                        return new NoSqlAccountAttachedResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Graph) {
                        return new GraphAccountAttachedResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Table) {
                        return new TableAccountAttachedResourceItem(accountModel, experience);
                    }

                    // Unknown experience
                    return undefined;
                })
                .filter((r) => r !== undefined),
        );
    }
}
