/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from 'pg';
import * as vscode from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { checkAuthentication } from './checkAuthentication';

export async function copyConnectionString(context: IActionContext, node: PostgresDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    const clientConfig: ClientConfig = await checkAuthentication(context, node);

    const user: string = nonNullProp(clientConfig, 'user');
    const password: string = nonNullProp(clientConfig, 'password');
    const host: string = nonNullProp(clientConfig, 'host');
    const port: string = String(nonNullProp(clientConfig, 'port'));
    const connectionString = `postgres://${user}:${password}@${host}:${port}/"${node.databaseName}"`;
    await vscode.env.clipboard.writeText(connectionString);
    const message = localize('copiedPostgresConnectStringMsg', 'The connection string has been copied to the clipboard');
    vscode.window.showInformationMessage(message);
}
