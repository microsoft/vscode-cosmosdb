/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';
import { connectPostgresDatabase } from './connectPostgresDatabase';

export async function createPostgresDatabase(context: IActionContext, node?: PostgresServerTreeItem): Promise<void> {
    if (!node) {
        node = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }
    const newDatabase: PostgresDatabaseTreeItem = await node.createChild(context);
    await connectPostgresDatabase(context, newDatabase);
    const createMessage: string = localize('createPostgresDatabaseMsg', 'Successfully created database "{0}".', newDatabase.databaseName);
    void vscode.window.showInformationMessage(createMessage);
    ext.outputChannel.appendLog(createMessage);
}
