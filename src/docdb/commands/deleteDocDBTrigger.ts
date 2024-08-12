/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { DocDBTriggerTreeItem } from '../tree/DocDBTriggerTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function deleteDocDBTrigger(context: IActionContext, node?: DocDBTriggerTreeItem) {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBTriggerTreeItem>(context, DocDBTriggerTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}
