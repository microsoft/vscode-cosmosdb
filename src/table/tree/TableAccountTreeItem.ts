/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureNode, IAzureTreeItem } from "vscode-azureextensionui";
import { DocDBAccountTreeItemBase } from "../../docdb/tree/DocDBAccountTreeItemBase";

export class TableAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = "cosmosDBTableAccount";
    public contextValue: string = TableAccountTreeItem.contextValue;

    public hasMoreChildren(): boolean {
        return false;
    }

    public initChild(): IAzureTreeItem {
        throw new Error('Table Accounts are not supported yet.');
    }

    public async loadMoreChildren(_node: IAzureNode, _clearCache: boolean): Promise<IAzureTreeItem[]> {
        return [{
            id: 'tableNotSupported',
            contextValue: 'tableNotSupported',
            label: 'Table Accounts are not supported yet.'
        }];
    }
}
