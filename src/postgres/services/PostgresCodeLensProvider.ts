/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IActionContext } from '@microsoft/vscode-azext-utils';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import  { type CodeLens, type CodeLensProvider, type Event, type ProviderResult} from 'vscode';
import { EventEmitter, Position, Range } from 'vscode';
import { localize } from '../../utils/localize';

export class PostgresCodeLensProvider implements CodeLensProvider {
    private _onDidChangeEmitter: EventEmitter<void> = new EventEmitter<void>();
    private _connectedDatabase: string | undefined;
    private _connectedDatabaseInitialized: boolean;

    public get onDidChangeCodeLenses(): Event<void> {
        return this._onDidChangeEmitter.event;
    }

    public setConnectedDatabase(database: string | undefined): void {
        this._connectedDatabase = database;
        this._connectedDatabaseInitialized = true;
        this._onDidChangeEmitter.fire();
    }

    public provideCodeLenses(): ProviderResult<CodeLens[]> {
        return callWithTelemetryAndErrorHandling('postgreSQL.provideCodeLenses', (context: IActionContext) => {
            // Suppress except for errors - this can fire on every keystroke
            context.telemetry.suppressIfSuccessful = true;

            const isInitialized = this._connectedDatabaseInitialized;
            const isConnected = !!this._connectedDatabase;
            const database = isConnected && this._connectedDatabase;
            const lenses: CodeLens[] = [];

            let title: string;
            if (!isInitialized) {
                title = localize('initializing', 'Initializing...');
            } else if (isConnected) {
                title = localize('connectedToDatabase', 'Connected to "{0}"', database);
            } else {
                title = localize('connectToDatabase', 'Connect to a database');
            }

            //  Allow displaying and changing connected database
            lenses.push(<CodeLens>{
                command: {
                    title,
                    command: isInitialized && 'postgreSQL.connectDatabase',
                },
                range: new Range(new Position(0, 0), new Position(0, 0)),
            });

            if (isConnected) {
                lenses.push(<CodeLens>{
                    command: {
                        title: 'Execute Query',
                        command: 'postgreSQL.executeQuery',
                    },
                    range: new Range(new Position(0, 0), new Position(0, 0)),
                });
            }

            return lenses;
        });
    }
}
