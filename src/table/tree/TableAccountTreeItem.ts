/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, GenericTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import { deleteCosmosDBAccount } from '../../commands/deleteCosmosDBAccount';
import { DocDBAccountTreeItemBase } from "../../docdb/tree/DocDBAccountTreeItemBase";

export class TableAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = "cosmosDBTableAccount";
    public contextValue: string = TableAccountTreeItem.contextValue;

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public initChild(): AzExtTreeItem {
        throw new Error('Table Accounts are not supported yet.');
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        const tableNotFoundTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
            contextValue: 'tableNotSupported',
            label: 'Table Accounts are not supported yet.'
        });
        tableNotFoundTreeItem.suppressMaskLabel = true;
        return [tableNotFoundTreeItem];
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        await deleteCosmosDBAccount(context, this);
    }

    public isAncestorOfImpl(): boolean {
        return false;
    }
}
