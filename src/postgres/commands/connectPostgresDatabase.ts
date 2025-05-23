/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { connectedPostgresKey, postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';

export async function connectPostgresDatabase(
    context: IActionContext,
    treeItem?: vscode.Uri | PostgresDatabaseTreeItem,
): Promise<void> {
    if (!treeItem || treeItem instanceof vscode.Uri) {
        if (treeItem) {
            void vscode.window.showTextDocument(treeItem);
        }
        treeItem = await ext.rgApi.pickAppResource<PostgresDatabaseTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
            expectedChildContextValue: PostgresDatabaseTreeItem.contextValue,
        });
    }

    const oldTreeItemId: string | undefined = ext.connectedPostgresDB && ext.connectedPostgresDB.fullId;
    void ext.context.globalState.update(connectedPostgresKey, treeItem.fullId);
    ext.connectedPostgresDB = treeItem;
    const database = treeItem && treeItem.label;
    if (ext.postgresCodeLensProvider) {
        ext.postgresCodeLensProvider.setConnectedDatabase(database);
    }
    await treeItem.refresh(context);

    if (oldTreeItemId) {
        // We have to use findTreeItem to get the instance of the old tree item that's being displayed in the ext.rgApi.appResourceTree. Our specific instance might have been out-of-date
        const oldTreeItem: AzExtTreeItem | undefined = await ext.rgApi.appResourceTree.findTreeItem(
            oldTreeItemId,
            context,
        );
        if (oldTreeItem) {
            await oldTreeItem.refresh(context);
        }
    }
}
