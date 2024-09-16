/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { DocDBStoredProcedureTreeItem } from '../tree/DocDBStoredProcedureTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function deleteDocDBStoredProcedure(
    context: IActionContext,
    node?: DocDBStoredProcedureTreeItem,
): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBStoredProcedureTreeItem>(context, DocDBStoredProcedureTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}
