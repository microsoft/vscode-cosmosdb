/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { BaseCachedBranchDataProvider } from '../../tree/BaseCachedBranchDataProvider';
import { type TreeElement } from '../../tree/TreeElement';

export async function refreshTreeElement(context: IActionContext, node?: TreeElement): Promise<void> {
    if (!node) {
        return ext.cosmosDBBranchDataProvider.refresh();
    }

    if (node && 'refresh' in node && typeof node.refresh === 'function') {
        await node.refresh.call(node, context);
        return;
    }

    if (node.dataProvider && node.dataProvider instanceof BaseCachedBranchDataProvider) {
        return node.dataProvider.refresh(node);
    }

    if (node && 'id' in node && typeof node.id === 'string') {
        return ext.state.notifyChildrenChanged(node.id);
    }
}
