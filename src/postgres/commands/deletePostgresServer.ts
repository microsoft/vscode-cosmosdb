/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { deleteDatabaseAccount } from '../../commands/deleteDatabaseAccount/deleteDatabaseAccount';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import  { type PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';

export async function deletePostgresServer(context: IActionContext, node?: PostgresServerTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await ext.rgApi.pickAppResource<PostgresServerTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
        });
    }

    await deleteDatabaseAccount(context, node, true);
}
