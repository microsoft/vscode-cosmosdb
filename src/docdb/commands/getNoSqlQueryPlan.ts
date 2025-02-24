/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ViewColumn } from 'vscode';
import { KeyValueStore } from '../../KeyValueStore';
import { localize } from '../../utils/localize';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { noSqlQueryConnectionKey, type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { getCosmosClient, type CosmosDBCredential } from '../getCosmosClient';

export async function getNoSqlQueryPlan(
    _context: IActionContext,
    args: { queryText: string } | undefined,
): Promise<void> {
    let queryText: string;
    if (!args) {
        const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

        if (!activeEditor?.document) {
            throw new Error(localize('openQueryBeforeExecuting', 'Open a NoSQL query before executing.'));
        }
        queryText = activeEditor.document.getText();
    } else {
        queryText = args.queryText;
    }
    const connectedCollection = KeyValueStore.instance.get(noSqlQueryConnectionKey);
    if (!connectedCollection) {
        throw new Error('Unable to get query plan due to missing node data. Please connect to a Cosmos DB collection.');
    } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { databaseId, containerId, endpoint, masterKey, emulatorConfiguration, tenantId } =
            connectedCollection as NoSqlQueryConnection;
        const credentials: CosmosDBCredential[] = [];
        if (masterKey !== undefined) {
            credentials.push({ type: 'key', key: masterKey });
        }
        credentials.push({ type: 'auth', tenantId: tenantId });
        const client = getCosmosClient(endpoint, credentials, emulatorConfiguration.isEmulator);
        const response = await client.database(databaseId).container(containerId).getQueryPlan(queryText);
        await vscodeUtil.showNewFile(
            JSON.stringify(response.result, undefined, 2),
            `query results for ${containerId}`,
            '.json',
            ViewColumn.Beside,
        );
    }
}
