/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { isSortable } from '../../tree/mixins/Sortable';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';

export async function sortTreeItems(context: IActionContext, node?: TreeElement | FabricTreeElement): Promise<void> {
    const element: TreeElement | undefined = isFabricTreeElement(node)
        ? node.element
        : isTreeElement(node)
            ? node
            : undefined;

    if (!element) {
        return;
    }

    if (isTreeElementWithExperience(element)) {
        context.telemetry.properties.experience = element.experience.api;
    }

    if (isSortable(element)) {
        await element.handleSortCommand();
    }

    return ext.state.notifyChildrenChanged(element.id);
}
