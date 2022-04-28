/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { deleteDatabaseAccount } from '../../commands/deleteDatabaseAccount/deleteDatabaseAccount';
import { ext } from '../../extensionVariables';
import { PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';

export async function deletePostgresServer(context: IActionContext, node?: PostgresServerTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = <PostgresServerTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }

    await deleteDatabaseAccount(context, node, true)
}
