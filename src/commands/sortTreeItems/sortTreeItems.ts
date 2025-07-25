/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { isSortable } from '../../tree/cosmosdb/mixins/Sortable';
import { type TreeElement } from '../../tree/TreeElement';

export async function sortTreeItems(_context: IActionContext, node: TreeElement): Promise<void> {
    if (isSortable(node)) {
        await node.handleSortCommand();
    }

    return ext.state.notifyChildrenChanged(node.id);
}
