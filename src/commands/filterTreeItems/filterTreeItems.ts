/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { isFilterable } from '../../tree/mixins/Filterable';
import { type TreeElement } from '../../tree/TreeElement';

export async function filterTreeItems(_context: IActionContext, node: TreeElement): Promise<void> {
    if (isFilterable(node)) {
        await node.handleFilterCommand();
    }

    return ext.state.notifyChildrenChanged(node.id);
}
