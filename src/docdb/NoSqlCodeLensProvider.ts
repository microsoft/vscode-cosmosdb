/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { KeyValueStore } from '../KeyValueStore';

export type NoSqlQueryConnection = {
    databaseId: string;
    containerId: string;
    endpoint: string;
    masterKey?: string;
    isEmulator: boolean;
    tenantId: string | undefined;
};

export const noSqlQueryConnectionKey = 'NO_SQL_QUERY_CONNECTION_KEY.v1';

export class NoSqlCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

    public get onDidChangeCodeLenses(): vscode.Event<void> {
        return this._onDidChangeEmitter.event;
    }

    public updateCodeLens(): void {
        this._onDidChangeEmitter.fire();
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        return callWithTelemetryAndErrorHandling('nosql.provideCodeLenses', (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;
            const text = document.getText();
            const queryText = text;

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
            const connectedCollection: NoSqlQueryConnection | undefined = KeyValueStore.instance.get(
                noSqlQueryConnectionKey,
            ) as unknown as NoSqlQueryConnection;
            let connectCodeLens: vscode.CodeLens;
            if (!connectedCollection) {
                connectCodeLens = new vscode.CodeLens(
                    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
                    {
                        title: 'Not connected',
                        command: 'cosmosDB.connectNoSqlContainer',
                        arguments: [],
                    },
                );
            } else {
                connectCodeLens = new vscode.CodeLens(
                    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
                    {
                        title: vscode.l10n.t(
                            `Connected to {0}`,
                            `${connectedCollection.databaseId}.${connectedCollection.containerId}`,
                        ),
                        command: 'cosmosDB.connectNoSqlContainer',
                        arguments: [],
                    },
                );
            }
            const lenses: vscode.CodeLens[] = [
                connectCodeLens,
                new vscode.CodeLens(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), {
                    title: vscode.l10n.t('Execute'),
                    command: 'cosmosDB.executeNoSqlQuery',
                    arguments: [{ queryText }],
                }),
                new vscode.CodeLens(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), {
                    title: vscode.l10n.t('Execute with Query Metrics'),
                    command: 'cosmosDB.executeNoSqlQuery',
                    arguments: [{ queryText, populateQueryMetrics: true }],
                }),
                new vscode.CodeLens(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), {
                    title: vscode.l10n.t('Get Query Plan'),
                    command: 'cosmosDB.getNoSqlQueryPlan',
                    arguments: [{ queryText }],
                }),
            ];

            return lenses;
        });
    }
}
