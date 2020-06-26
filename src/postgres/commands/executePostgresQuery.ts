/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EOL } from 'os';
import * as path from 'path';
import { ClientConfig, QueryResult } from 'pg';
import * as vscode from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { runPostgresQuery } from '../runPostgresQuery';
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

    if (!activeEditor?.document) {
        throw new Error(localize('openQueryBeforeExecuting', 'Open a PostgreSQL query before executing.'));
    }

    const query: string | undefined = activeEditor.document.getText();
    const queryResult: QueryResult = await runPostgresQuery(clientConfig, query);
    ext.outputChannel.appendLine(localize('executedQuery', 'Successfully executed "{0}" query.', queryResult.command));

    if (queryResult.rowCount) {
        const fileExtension: string = path.extname(activeEditor.document.fileName);
        const queryFileName: string = path.basename(activeEditor.document.fileName, fileExtension);
        const outputFileName: string = `${queryFileName}-output`;

        const fields: string[] = queryResult.fields.map(f => f.name);
        let csvData: string = `${fields.join(',')}${EOL}`;

        for (const row of queryResult.rows) {
            const fieldValues: string[] = [];
            for (const field of fields) {
                fieldValues.push(row[field]);
            }
            csvData += `${fieldValues.join(',')}${EOL}`;
        }

        await vscodeUtil.showNewFile(csvData, outputFileName, '.csv');
    }
}
