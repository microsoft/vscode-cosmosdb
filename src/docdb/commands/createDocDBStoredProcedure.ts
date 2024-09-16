/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { commands } from 'vscode';
import { DocDBStoredProceduresTreeItem } from '../tree/DocDBStoredProceduresTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function createDocDBStoredProcedure(
    context: IActionContext,
    node?: DocDBStoredProceduresTreeItem,
): Promise<void> {
    if (!node) {
        node = await pickDocDBAccount<DocDBStoredProceduresTreeItem>(
            context,
            DocDBStoredProceduresTreeItem.contextValue,
        );
    }
    const childNode = await node.createChild(context);
    await commands.executeCommand('cosmosDB.openStoredProcedure', childNode);
}
