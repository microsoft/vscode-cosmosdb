/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { isSortable } from '../../tree/mixins/Sortable';
import { type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';

export async function sortTreeItems(context: IActionContext, node?: TreeElement): Promise<void> {
    if (!node) {
        return undefined;
    }

    if (isTreeElementWithExperience(node)) {
        context.telemetry.properties.experience = node.experience.api;
    }

    if (isSortable(node)) {
        await node.handleSortCommand();
    }

    return ext.state.notifyChildrenChanged(node.id);
}
