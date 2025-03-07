/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

export class PostgresCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    private _connectedDatabase: string | undefined;
    private _connectedDatabaseInitialized: boolean;

    public get onDidChangeCodeLenses(): vscode.Event<void> {
        return this._onDidChangeEmitter.event;
    }

    public setConnectedDatabase(database: string | undefined): void {
        this._connectedDatabase = database;
        this._connectedDatabaseInitialized = true;
        this._onDidChangeEmitter.fire();
    }

    public provideCodeLenses(): vscode.ProviderResult<vscode.CodeLens[]> {
        return callWithTelemetryAndErrorHandling('postgreSQL.provideCodeLenses', (context: IActionContext) => {
            // Suppress except for errors - this can fire on every keystroke
            context.telemetry.suppressIfSuccessful = true;

            const isInitialized = this._connectedDatabaseInitialized;
            const isConnected = !!this._connectedDatabase;
            const database = (isConnected && this._connectedDatabase) || '';
            const lenses: vscode.CodeLens[] = [];

            let title: string;
            if (!isInitialized) {
                title = vscode.l10n.t('Initializing...');
            } else if (isConnected) {
                title = vscode.l10n.t('Connected to "{0}"', database);
            } else {
                title = vscode.l10n.t('Connect to a database');
            }

            //  Allow displaying and changing connected database
            lenses.push(<vscode.CodeLens>{
                command: {
                    title,
                    command: isInitialized && 'postgreSQL.connectDatabase',
                },
                range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            });

            if (isConnected) {
                lenses.push(<vscode.CodeLens>{
                    command: {
                        title: 'Execute Query',
                        command: 'postgreSQL.executeQuery',
                    },
                    range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
                });
            }

            return lenses;
        });
    }
}
