/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { QueryEditorTab } from '../../panels/QueryEditorTab';
import { CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { BaseCachedBranchDataProvider } from '../../tree/BaseCachedBranchDataProvider';
import { CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type TreeElement } from '../../tree/TreeElement';

export async function refreshTreeElement(context: IActionContext, node?: TreeElement): Promise<void> {
    if (!node) {
        return ext.cosmosDBBranchDataProvider.refresh();
    }

    if (node && 'refresh' in node && typeof node.refresh === 'function') {
        await node.refresh.call(node, context);
        notifyThroughputBucketRefresh(node);
        return;
    }

    if (node.dataProvider && node.dataProvider instanceof BaseCachedBranchDataProvider) {
        node.dataProvider.refresh(node);
        notifyThroughputBucketRefresh(node);
        return;
    }

    if (node && 'id' in node && typeof node.id === 'string') {
        ext.state.notifyChildrenChanged(node.id);
        notifyThroughputBucketRefresh(node);
    }
}

function notifyThroughputBucketRefresh(node: TreeElement): void {
    if (node instanceof CosmosDBContainerResourceItem) {
        QueryEditorTab.refreshThroughputBucketsForContainer(
            node.model.accountInfo.id,
            node.model.database.id,
            node.model.container.id,
        );
    } else if (node instanceof CosmosDBAccountResourceItemBase) {
        QueryEditorTab.refreshThroughputBucketsForContainer(node.id);
    }
}
