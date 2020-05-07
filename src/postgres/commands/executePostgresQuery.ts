/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, QueryResult } from 'pg';
import * as vscode from 'vscode';
import { AzExtTreeItem, IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { configurePostgresFirewall } from './configurePostgresFirewall';
import { enterPostgresCredentials } from './enterPostgresCredentials';
import { loadPersistedPostgresDatabase } from './registerPostgresCommands';

export async function executePostgresQuery(context: IActionContext, treeItem?: PostgresDatabaseTreeItem): Promise<void> {
    await loadPersistedPostgresDatabase();

    if (!treeItem) {
        if (ext.connectedPostgresDB) {
            treeItem = ext.connectedPostgresDB;
        } else {
            treeItem = <PostgresDatabaseTreeItem>await ext.tree.showTreeItemPicker(PostgresDatabaseTreeItem.contextValue, context);
        }
    }

    if (!treeItem.clientConfig) {
        let children: AzExtTreeItem[] = await treeItem.loadAllChildren(context);

        while (children.length === 1) {
            // One child was returned meaning there was a problem connecting to the server

            if (children[0].contextValue === 'postgresCredentials') {
                await enterPostgresCredentials(context, treeItem.parent);
            } else if (children[0].contextValue === 'postgresFirewall') {
                await configurePostgresFirewall(context, treeItem.parent);
            }

            await treeItem.refresh();
            children = await treeItem.loadAllChildren(context);
        }
    }

    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    const query: string | undefined = activeEditor?.document.getText();

    if (!query) {
        throw new Error(localize('openQueryBeforeExecuting', 'Open a PostgreSQL query before executing.'));
    }

    const client: Client = new Client(treeItem.clientConfig);
    await client.connect();
    const queryResult: QueryResult = await client.query(query);

    let resultString: string = localize('executedQuery', 'Successfully executed "{0}" query.', queryResult.command);
    const fieldNames: string[] = queryResult.fields.map(field => field.name);
    const fieldsString: string = queryResult.fields.length ? `[${fieldNames.join(', ')}]` : 'none';
    resultString += localize('fieldsReturned', '\n\tFields returned: {0}', fieldsString);

    ext.outputChannel.show();
    ext.outputChannel.appendLine(resultString);
}
