/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../../tree/TreeElement';

export async function refreshTreeElement(context: IActionContext, node: AzExtTreeItem | TreeElement): Promise<void> {
    if (node instanceof AzExtTreeItem) {
        return node.refresh(context);
    }

    if (node && 'refresh' in node && typeof node.refresh === 'function') {
        await node.refresh.call(node, context);
        return;
    }

    if (node && 'contextValue' in node && typeof node.contextValue === 'string') {
        if (/experience[.](mongocluster)/i.test(node.contextValue)) {
            return ext.mongoVCoreBranchDataProvider.refresh(node);
        }

        if (/experience[.](table|cassandra|core|graph|mongodb)/i.test(node.contextValue)) {
            return ext.cosmosDBBranchDataProvider.refresh(node);
        }
    }

    if (node && 'id' in node && typeof node.id === 'string') {
        return ext.state.notifyChildrenChanged(node.id);
    }
}
