/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { KeyValueStore } from '../../KeyValueStore';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { noSqlQueryConnectionKey, type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { getCosmosClient, type CosmosDBCredential } from '../getCosmosClient';

export async function executeNoSqlQuery(
    _context: IActionContext,
    args: { queryText: string; populateQueryMetrics?: boolean },
): Promise<void> {
    let queryText: string;
    let populateQueryMetrics: boolean;
    if (!args) {
        const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

        if (!activeEditor?.document) {
            throw new Error(l10n.t('Open a NoSQL query before executing.'));
        }
        queryText = activeEditor.document.getText();
        populateQueryMetrics = false;
    } else {
        queryText = args.queryText;
        populateQueryMetrics = !!args.populateQueryMetrics;
    }
    const connectedCollection = KeyValueStore.instance.get(noSqlQueryConnectionKey);
    if (!connectedCollection) {
        throw new Error(
            l10n.t('Unable to execute query due to missing node data. Please connect to a Cosmos DB container node.'),
        );
    } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { databaseId, containerId, endpoint, masterKey, isEmulator, tenantId } =
            connectedCollection as NoSqlQueryConnection;
        const credentials: CosmosDBCredential[] = [];
        if (masterKey !== undefined) {
            credentials.push({ type: 'key', key: masterKey });
        }
        credentials.push({ type: 'auth', tenantId: tenantId });
        const client = getCosmosClient(endpoint, credentials, isEmulator);
        const options = { populateQueryMetrics };
        const response = await client
            .database(databaseId)
            .container(containerId)
            .items.query(queryText, options)
            .fetchAll();
        const resultDocumentTitle = l10n.t('query results for {0}', containerId);
        if (populateQueryMetrics === true) {
            await vscodeUtil.showNewFile(
                JSON.stringify(
                    {
                        result: response.resources,
                        queryMetrics: response.queryMetrics,
                    },
                    undefined,
                    2,
                ),
                resultDocumentTitle,
                '.json',
                vscode.ViewColumn.Beside,
            );
        } else {
            await vscodeUtil.showNewFile(
                JSON.stringify(response.resources, undefined, 2),
                resultDocumentTitle,
                '.json',
                vscode.ViewColumn.Beside,
            );
        }
    }
}
