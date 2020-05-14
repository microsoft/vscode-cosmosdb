/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig, QueryResult } from 'pg';
import * as vscode from 'vscode';
import { IActionContext, IParsedError, parseError } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { firewallNotConfiguredErrorType, invalidCredentialsErrorType, PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { configurePostgresFirewall } from './configurePostgresFirewall';
import { enterPostgresCredentials } from './enterPostgresCredentials';
import { loadPersistedPostgresDatabase } from './registerPostgresCommands';

export async function executePostgresQuery(context: IActionContext): Promise<void> {
    await loadPersistedPostgresDatabase();

    let treeItem: PostgresDatabaseTreeItem;
    if (ext.connectedPostgresDB) {
        treeItem = ext.connectedPostgresDB;
    } else {
        treeItem = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    let clientConfig: ClientConfig | undefined;
    while (!clientConfig) {
        try {
            clientConfig = await treeItem.getClientConfig();
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (parsedError.errorType === invalidCredentialsErrorType) {
                await enterPostgresCredentials(context, treeItem.parent);
            } else if (parsedError.errorType === firewallNotConfiguredErrorType) {
                await configurePostgresFirewall(context, treeItem.parent);
            } else {
                throw error;
            }
        }
    }

    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    const query: string | undefined = activeEditor?.document.getText();

    if (!query) {
        throw new Error(localize('openQueryBeforeExecuting', 'Open a PostgreSQL query before executing.'));
    }

    const client: Client = new Client(clientConfig);
    await client.connect();
    const queryResult: QueryResult = await client.query(query);

    let resultString: string = localize('executedQuery', 'Successfully executed "{0}" query.', queryResult.command);
    if (queryResult.rowCount) {
        resultString += `\n\t${JSON.stringify(queryResult.rows)}`;
    }

    ext.outputChannel.show();
    ext.outputChannel.appendLine(resultString);
}
