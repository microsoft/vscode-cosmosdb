/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { DocDBStoredProcedureTreeItem } from '../tree/DocDBStoredProcedureTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function openStoredProcedure(context: IActionContext, node?: DocDBStoredProcedureTreeItem) {
    if (!node) {
        node = await pickDocDBAccount<DocDBStoredProcedureTreeItem>(context, DocDBStoredProcedureTreeItem.contextValue);
    }
    await ext.fileSystem.showTextDocument(node);
}
