/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, AzureAccountTreeItem } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { AttachedAccountsTreeItem } from './AttachedAccountsTreeItem';
import { CosmosDBAccountProvider } from './CosmosDBAccountProvider';

export class AzureAccountTreeItemWithAttached extends AzureAccountTreeItem {
    public constructor() {
        super(undefined, CosmosDBAccountProvider);
        ext.attachedAccountsNode = new AttachedAccountsTreeItem(this);
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        const children: AzExtTreeItem[] = await super.loadMoreChildrenImpl(clearCache);
        return children.concat(ext.attachedAccountsNode);
    }

    public compareChildrenImpl(item1: AzExtTreeItem, item2: AzExtTreeItem): number {
        if (item1 instanceof AttachedAccountsTreeItem) {
            return 1;
        } else if (item2 instanceof AttachedAccountsTreeItem) {
            return -1;
        } else {
            return super.compareChildrenImpl(item1, item2);
        }
    }
}
