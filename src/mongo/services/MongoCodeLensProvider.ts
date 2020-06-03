/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { callWithTelemetryAndErrorHandling, IActionContext } from "vscode-azureextensionui";
import { getAllCommandsFromTextDocument } from "../MongoScrapbook";

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

    public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        return callWithTelemetryAndErrorHandling("mongo.provideCodeLenses", (context: IActionContext) => {
            // Suppress except for errors - this can fire on every keystroke
            context.telemetry.suppressIfSuccessful = true;

            const isInitialized = this._connectedDatabaseInitialized;
            const isConnected = !!this._connectedDatabase;
            const database = isConnected && this._connectedDatabase;
            const lenses: vscode.CodeLens[] = [];

            // Allow displaying and changing connected database
            lenses.push(<vscode.CodeLens>{
                command: {
                    title: !isInitialized ?
                        'Initializing...' :
                        isConnected ?
                            `Connected to ${database}` :
                            `Connect to a database`,
                    command: isInitialized && 'cosmosDB.connectMongoDB'
                },
                range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0))
            });

            if (isConnected) {
                // Run all
                lenses.push(<vscode.CodeLens>{
                    command: {
                        title: "Execute All",
                        command: 'cosmosDB.executeAllMongoCommands'
                    },
                    range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0))
                });

                const commands = getAllCommandsFromTextDocument(document);
                for (const cmd of commands) {
                    // run individual
                    lenses.push(<vscode.CodeLens>{
                        command: {
                            title: "Execute",
                            command: 'cosmosDB.executeMongoCommand'
                        },
                        range: cmd.range
                    });
                }
            }

            return lenses;
        });
    }
}
