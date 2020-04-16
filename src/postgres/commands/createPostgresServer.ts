/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { SubscriptionTreeItem } from '../../tree/SubscriptionTreeItem';

export async function createPostgresServer(context: IActionContext, node?: SubscriptionTreeItem): Promise<void> {
    if (!node) {
        node = await ext.tree.showTreeItemPicker<SubscriptionTreeItem>(SubscriptionTreeItem.contextValue, context);
    }

    await node.createChild(context);
}
