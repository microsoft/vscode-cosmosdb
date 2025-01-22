/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getAllCommandsFromTextDocument } from '../MongoScrapbook';

/**
 * Provides Code Lens functionality for the Mongo Scrapbook editor.
 *
 * @remarks
 * This provider enables several helpful actions directly within the editor:
 *
 * 1. **Connection Status Lens**:
 *    - Displays the current database connection state (e.g., connecting, connected).
 *    - Offers the ability to connect to a MongoDB database if one is not yet connected.
 *
 * 2. **Execute All Commands Lens**:
 *    - Runs all detected MongoDB commands in the scrapbook document at once when triggered.
 *
 * 3. **Execute Single Command Lens**:
 *    - Appears for each individual MongoDB command found in the scrapbook.
 *    - Invokes execution of the command located at the specified range in the document.
 *
 * By leveraging these lenses, the user can initialize or change the database connection, as well
 * as selectively run or run all commands without manually invoking relevant commands.
 */
export class MongoCodeLensProvider implements vscode.CodeLensProvider {
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

    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        return callWithTelemetryAndErrorHandling('mongo.provideCodeLenses', (context: IActionContext) => {
            // Suppress except for errors - this can fire on every keystroke
            context.telemetry.suppressIfSuccessful = true;

            const isInitialized = this._connectedDatabaseInitialized;
            const isConnected = !!this._connectedDatabase;
            const database = isConnected && this._connectedDatabase;
            const lenses: vscode.CodeLens[] = [];

            // Allow displaying and changing connected database
            const title = !isInitialized
                ? 'Initializing...'
                : isConnected
                  ? `Connected to "${database}"`
                  : 'Connect to a database';

            lenses.push(<vscode.CodeLens>{
                command: {
                    title: '🌐 ' + title,
                    command: isInitialized && 'cosmosDB.connectMongoDB',
                },
                range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            });

            lenses.push(<vscode.CodeLens>{
                command: {
                    title: '⏩ Execute All',
                    command: 'cosmosDB.executeAllMongoCommands',
                },
                range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            });

            const commands = getAllCommandsFromTextDocument(document);
            for (const cmd of commands) {
                // run individual
                lenses.push(<vscode.CodeLens>{
                    command: {
                        title: '▶️ Execute',
                        command: 'cosmosDB.executeMongoCommand',
                        arguments: [cmd.range.start],
                    },
                    range: cmd.range,
                });
            }

            return lenses;
        });
    }
}
