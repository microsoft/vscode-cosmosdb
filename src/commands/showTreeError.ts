/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { isFabricTreeElement, type FabricTreeElement } from '../tree/fabric-resources-view/FabricTreeElement';
import { isTreeElement, type TreeElement } from '../tree/TreeElement';

export function showTreeError(): void {
    ext.outputChannel.show();
}

export async function copyTreeError(context: IActionContext, node?: TreeElement | FabricTreeElement): Promise<void> {
    const element = isFabricTreeElement(node) ? node.element : node;
    if (!isTreeElement(element)) {
        throw new Error(l10n.t('Select an error node to copy its message.'));
    }

    const label = (await element.getTreeItem()).label;
    const message = typeof label === 'string' ? label : label?.label;
    if (!message) {
        throw new Error(l10n.t('The selected error node has no error message.'));
    }

    context.valuesToMask.push(message);
    await vscode.env.clipboard.writeText(message);
}
