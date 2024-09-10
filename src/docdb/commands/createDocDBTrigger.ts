/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { commands } from 'vscode';
import { DocDBTriggersTreeItem } from '../tree/DocDBTriggersTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function createDocDBTrigger(context: IActionContext, node?: DocDBTriggersTreeItem) {
    if (!node) {
        node = await pickDocDBAccount<DocDBTriggersTreeItem>(context, DocDBTriggersTreeItem.contextValue);
    }
    const childNode = await node.createChild(context);
    await commands.executeCommand('cosmosDB.openTrigger', childNode);
}
