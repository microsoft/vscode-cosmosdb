/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { isFilterable } from '../../tree/mixins/Filterable';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';

export async function filterTreeItems(_context: IActionContext, node?: TreeElement | FabricTreeElement): Promise<void> {
    const element: TreeElement | undefined = isFabricTreeElement(node)
        ? node.element
        : isTreeElement(node)
          ? node
          : undefined;

    if (!element) {
        return;
    }

    if (isFilterable(element)) {
        await element.handleFilterCommand();
    }

    return ext.state.notifyChildrenChanged(element.id);
}
