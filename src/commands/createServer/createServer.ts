/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { SubscriptionTreeItem } from '../../tree/SubscriptionTreeItem';

/**
 * At this moment this function is relying on old V1 implementation of the API.
 */
export async function createServer(context: IActionContext, node?: SubscriptionTreeItem): Promise<void> {
    if (!node) {
        node = await ext.rgApi.appResourceTree.showTreeItemPicker<SubscriptionTreeItem>(
            SubscriptionTreeItem.contextValue,
            context,
        );
    }

    await SubscriptionTreeItem.createChild(context, node);
}
