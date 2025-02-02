/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { type CosmosDBTreeElement } from '../../tree/CosmosDBTreeElement';

export async function refreshTreeElement(
    context: IActionContext,
    node: AzExtTreeItem | CosmosDBTreeElement,
): Promise<void> {
    if (node instanceof AzExtTreeItem) {
        return node.refresh(context);
    }

    if (node && 'refresh' in node && typeof node.refresh === 'function') {
        await node.refresh.call(node, context);
        return;
    }

    if (node && 'contextValue' in node && typeof node.contextValue === 'string') {
        if (/experience[.](mongocluster|mongodb)/i.test(node.contextValue)) {
            return ext.mongoClustersBranchDataProvider.refresh(node);
        }

        if (/experience[.](table|cassandra|core|graph)/i.test(node.contextValue)) {
            return ext.cosmosDBBranchDataProvider.refresh(node);
        }
    }

    if (node && 'id' in node && typeof node.id === 'string') {
        return ext.state.notifyChildrenChanged(node.id);
    }
}
