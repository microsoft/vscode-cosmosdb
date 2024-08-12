/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { EOL } from 'os';
import * as path from 'path';
import { ClientConfig, QueryResult } from 'pg';
import * as vscode from 'vscode';
import { connectedPostgresKey, postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { runPostgresQuery } from '../runPostgresQuery';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { checkAuthentication } from './checkAuthentication';
import { connectPostgresDatabase } from './connectPostgresDatabase';

export async function loadPersistedPostgresDatabase(): Promise<void> {
    // NOTE: We want to make sure this function never throws or returns a rejected promise because it gets awaited multiple times
    await callWithTelemetryAndErrorHandling('postgreSQL.loadPersistedDatabase', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.isActivationEvent = 'true';

        try {
            const persistedTreeItemId: string | undefined = ext.context.globalState.get(connectedPostgresKey);
            if (persistedTreeItemId) {
                const persistedTreeItem: PostgresDatabaseTreeItem | undefined = <PostgresDatabaseTreeItem>(
                    await ext.rgApi.appResourceTree.findTreeItem(persistedTreeItemId, context)
                );
                if (persistedTreeItem) {
                    await connectPostgresDatabase(context, persistedTreeItem);
                }
            }
        } finally {
            // Get code lens provider out of initializing state if there's no connected DB
            if (!ext.connectedPostgresDB && ext.postgresCodeLensProvider) {
                ext.postgresCodeLensProvider.setConnectedDatabase(undefined);
            }
        }
    });
}

export async function executePostgresQueryInDocument(context: IActionContext): Promise<void> {
    await loadPersistedPostgresDatabase();

    let treeItem: PostgresDatabaseTreeItem;
    if (ext.connectedPostgresDB) {
        treeItem = ext.connectedPostgresDB;
    } else {
        treeItem = await ext.rgApi.pickAppResource<PostgresDatabaseTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
            expectedChildContextValue: PostgresDatabaseTreeItem.contextValue,
        });
    }

    const clientConfig: ClientConfig = await checkAuthentication(context, treeItem);

    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

    if (!activeEditor?.document) {
        throw new Error(localize('openQueryBeforeExecuting', 'Open a PostgreSQL query before executing.'));
    }

    const query: string | undefined = activeEditor.document.getText();
    const queryResult: QueryResult = await runPostgresQuery(clientConfig, query);
    ext.outputChannel.appendLog(localize('executedQuery', 'Successfully executed "{0}" query.', queryResult.command));

    if (queryResult.rowCount) {
        const fileExtension: string = path.extname(activeEditor.document.fileName);
        const queryFileName: string = path.basename(activeEditor.document.fileName, fileExtension);
        const outputFileName: string = `${queryFileName}-output`;

        const fields: string[] = queryResult.fields.map((f) => f.name);
        let csvData: string = `${fields.join(',')}${EOL}`;

        for (const row of queryResult.rows) {
            const fieldValues: string[] = [];
            for (const field of fields) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                fieldValues.push(row[field]);
            }
            csvData += `${fieldValues.join(',')}${EOL}`;
        }

        await vscodeUtil.showNewFile(csvData, outputFileName, '.csv');
    }
    await treeItem.refresh(context);
}
