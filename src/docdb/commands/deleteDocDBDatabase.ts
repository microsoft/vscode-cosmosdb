/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { DocDBDatabaseTreeItem } from '../tree/DocDBDatabaseTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function deleteDocDBDatabase(context: IActionContext, node?: DocDBDatabaseTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBDatabaseTreeItem>(context, DocDBDatabaseTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
    const successMessage = localize('deleteMongoDatabaseMsg', 'Successfully deleted database "{0}"', node.databaseName);
    void vscode.window.showInformationMessage(successMessage);
    ext.outputChannel.info(successMessage);
}
