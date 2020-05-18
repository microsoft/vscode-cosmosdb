/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig, QueryResult } from 'pg';
import * as vscode from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { checkAuthentication } from './checkAuthentication';
import { loadPersistedPostgresDatabase } from './registerPostgresCommands';

export async function executePostgresQuery(context: IActionContext): Promise<void> {
    await loadPersistedPostgresDatabase();

    let treeItem: PostgresDatabaseTreeItem;
    if (ext.connectedPostgresDB) {
        treeItem = ext.connectedPostgresDB;
    } else {
        treeItem = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
    }

    const clientConfig: ClientConfig = await checkAuthentication(context, treeItem);

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
