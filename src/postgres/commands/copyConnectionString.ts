/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from 'pg';
import * as vscode from 'vscode';
import { IActionContext, IParsedError, parseError } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { firewallNotConfiguredErrorType, invalidCredentialsErrorType, PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { configurePostgresFirewall } from './configurePostgresFirewall';
import { enterPostgresCredentials } from './enterPostgresCredentials';

export async function copyConnectionString(context: IActionContext, node: PostgresDatabaseTreeItem): Promise<void> {
    const message = 'The connection string has been copied to the clipboard';
    if (!node) {
        node = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    let clientConfig: ClientConfig | undefined;
    while (!clientConfig) {
        try {
            clientConfig = await node.getClientConfig();
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (parsedError.errorType === invalidCredentialsErrorType) {
                await enterPostgresCredentials(context, node.parent);
            } else if (parsedError.errorType === firewallNotConfiguredErrorType) {
                await configurePostgresFirewall(context, node.parent);
            } else {
                throw error;
            }
        }
    }

    await vscode.env.clipboard.writeText(node.connectionString);
    vscode.window.showInformationMessage(message);
}
