/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { addDatabaseToConnectionString, createPostgresConnectionString } from '../postgresConnectionStrings';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { checkAuthentication } from './checkAuthentication';

export async function copyConnectionString(context: IActionContext, node: PostgresDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    await checkAuthentication(context, node);
    const parsedConnectionString = await node.parent.getFullConnectionString();
    let connectionString: string;
    if (node.parent.azureName) {
        const parsedCS = await node.parent.getFullConnectionString();
        connectionString = createPostgresConnectionString(parsedCS.hostName, parsedCS.port, parsedCS.username, parsedCS.password, node.databaseName);
    } else {
        connectionString = addDatabaseToConnectionString(parsedConnectionString.connectionString, node.databaseName);
    }

    await vscode.env.clipboard.writeText(connectionString);
    const message = localize('copiedPostgresConnectStringMsg', 'The connection string has been copied to the clipboard');
    vscode.window.showInformationMessage(message);
}
