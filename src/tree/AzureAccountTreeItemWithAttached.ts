/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestAzureAccount } from 'vscode-azureextensiondev';
import { AzExtTreeItem, AzureAccountTreeItemBase, IActionContext, ISubscriptionContext } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { AttachedAccountsTreeItem } from './AttachedAccountsTreeItem';
import { SubscriptionTreeItem } from './SubscriptionTreeItem';

export class AzureAccountTreeItemWithAttached extends AzureAccountTreeItemBase {
    public constructor(testAccount?: TestAzureAccount) {
        super(undefined, testAccount);
        ext.attachedAccountsNode = new AttachedAccountsTreeItem(this);
    }

    public createSubscriptionTreeItem(root: ISubscriptionContext): SubscriptionTreeItem {
        return new SubscriptionTreeItem(this, root);
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        const children: AzExtTreeItem[] = await super.loadMoreChildrenImpl(clearCache, context);
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
