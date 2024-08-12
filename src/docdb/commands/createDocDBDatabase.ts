/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import { DocDBAccountTreeItem } from '../tree/DocDBAccountTreeItem';
import { DocDBDatabaseTreeItem } from '../tree/DocDBDatabaseTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function createDocDBDatabase(context: IActionContext, node?: DocDBAccountTreeItem): Promise<void> {
    if (!node) {
        node = await pickDocDBAccount<DocDBAccountTreeItem>(context);
    }
    const databaseNode: DocDBDatabaseTreeItem = await node.createChild(context);
    await databaseNode.createChild(context);
}
