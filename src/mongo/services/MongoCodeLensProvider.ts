/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getAllCommandsFromText } from '../MongoScrapbookHelpers';
import { MongoScrapbookService } from '../MongoScrapbookService';

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

    /**
     * An event to signal that the code lenses from this provider have changed.
     */
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
        return callWithTelemetryAndErrorHandling('mongo.provideCodeLenses', (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;

            const lenses: vscode.CodeLens[] = [];

            // Create connection status lens
            lenses.push(this.createConnectionStatusLens());

            // Create run-all lens
            lenses.push(this.createRunAllCommandsLens());

            // Create lenses for each individual command
            const commands = getAllCommandsFromText(document.getText());
            lenses.push(...this.createIndividualCommandLenses(commands));

            return lenses;
        });
    }

    private createConnectionStatusLens(): vscode.CodeLens {
        const title = MongoScrapbookService.isConnected()
            ? `Connected to "${MongoScrapbookService.getDisplayName()}"`
            : 'Connect to a database';

        const shortenedTitle =
            title.length > 64 ? title.slice(0, 64 / 2) + '...' + title.slice(-(64 - 3 - 64 / 2)) : title;

        return <vscode.CodeLens>{
            command: {
                title: '🌐 ' + shortenedTitle,
                tooltip: title,
                command: 'cosmosDB.connectMongoDB',
            },
            range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        };
    }

    private createRunAllCommandsLens(): vscode.CodeLens {
        const title = MongoScrapbookService.isExecutingAllCommands() ? '⏳ Running All...' : '⏩ Run All';

        return <vscode.CodeLens>{
            command: {
                title,
                command: 'cosmosDB.executeAllMongoCommands',
            },
            range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        };
    }

    private createIndividualCommandLenses(commands: { range: vscode.Range }[]): vscode.CodeLens[] {
        const currentCommandInExectution = MongoScrapbookService.getSingleCommandInExecution();

        return commands.map((cmd) => {
            const running = currentCommandInExectution && cmd.range.isEqual(currentCommandInExectution.range);
            const title = running ? '⏳ Running Command...' : '▶️ Run Command';

            return <vscode.CodeLens>{
                command: {
                    title,
                    command: 'cosmosDB.executeMongoCommand',
                    arguments: [cmd.range.start],
                },
                range: cmd.range,
            };
        });
    }
}
