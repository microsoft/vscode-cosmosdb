/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { DocDBCollectionTreeItem } from '../tree/DocDBCollectionTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function deleteDocDBCollection(context: IActionContext, node?: DocDBCollectionTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}
