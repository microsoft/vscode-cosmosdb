/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    GenericTreeItem,
    type AzExtTreeItem,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { API } from '../../AzureDBExperiences';
import { deleteCosmosDBAccount } from '../../commands/deleteDatabaseAccount/deleteCosmosDBAccount';
import { type IDeleteWizardContext } from '../../commands/deleteDatabaseAccount/IDeleteWizardContext';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';

export class TableAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = 'cosmosDBTableAccount';
    public contextValue: string = TableAccountTreeItem.contextValue;

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public initChild(): AzExtTreeItem {
        throw new Error('Table Accounts are not supported yet.');
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        const result = await callWithTelemetryAndErrorHandling(
            'getChildren',
            (context: IActionContext): AzExtTreeItem[] => {
                context.telemetry.properties.experience = API.Table;
                context.telemetry.properties.parentContext = this.contextValue;

                const tableNotFoundTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
                    contextValue: 'tableNotSupported',
                    label: 'Table Accounts are not supported yet.',
                });
                tableNotFoundTreeItem.suppressMaskLabel = true;
                return [tableNotFoundTreeItem];
            },
        );

        return result ?? [];
    }

    public async deleteTreeItemImpl(context: IDeleteWizardContext): Promise<void> {
        await deleteCosmosDBAccount(context, this);
    }

    public isAncestorOfImpl(): boolean {
        return false;
    }
}
