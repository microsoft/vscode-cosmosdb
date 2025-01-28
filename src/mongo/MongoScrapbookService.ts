/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openReadOnlyContent, type IActionContext } from '@microsoft/vscode-azext-utils';
import { EOL } from 'os';
import * as vscode from 'vscode';
import { CredentialCache } from '../mongoClusters/CredentialCache';
import { type DatabaseItemModel } from '../mongoClusters/MongoClustersClient';
import { type MongoClusterModel } from '../mongoClusters/tree/MongoClusterModel';
import { type MongoAccountModel } from '../tree/mongo/MongoAccountModel';
import { type MongoCommand } from './MongoCommand';
import { findCommandAtPosition, getAllCommandsFromText } from './MongoScrapbookHelpers';
import { MongoShellScriptRunner } from './MongoShellScriptRunner';
import { MongoCodeLensProvider } from './services/MongoCodeLensProvider';

export class MongoScrapbookServiceImpl {
    //--------------------------------------------------------------------------------
    // Connection Management
    //--------------------------------------------------------------------------------

    private _cluster: MongoClusterModel | MongoAccountModel | undefined;
    private _database: DatabaseItemModel | undefined;
    private readonly _mongoCodeLensProvider = new MongoCodeLensProvider();

    /**
     * Provides a CodeLens provider for the workspace.
     */
    public getCodeLensProvider(): MongoCodeLensProvider {
        return this._mongoCodeLensProvider;
    }

    /**
     * Sets the current cluster and database, updating the CodeLens provider.
     */
    public setConnectedCluster(cluster: MongoClusterModel | MongoAccountModel, database: DatabaseItemModel): void {
        this._cluster = cluster;
        this._database = database;
        this._mongoCodeLensProvider.updateCodeLens();
    }

    /**
     * Clears the current connection.
     */
    public clearConnection(): void {
        this._cluster = undefined;
        this._database = undefined;
        this._mongoCodeLensProvider.updateCodeLens();
    }

    /**
     * Returns true if a cluster and database are set.
     */
    public isConnected(): boolean {
        return !!this._cluster && !!this._database;
    }

    /**
     * Returns the current database name.
     */
    public getDatabaseName(): string | undefined {
        return this._database?.name;
    }

    /**
     * Returns the current cluster ID.
     */
    public getClusterId(): string | undefined {
        return this._cluster?.id;
    }

    /**
     * Returns a friendly display name of the connected cluster/database.
     */
    public getDisplayName(): string | undefined {
        return this._cluster && this._database ? `${this._cluster.name}/${this._database.name}` : undefined;
    }

    //--------------------------------------------------------------------------------
    // Command Execution
    //--------------------------------------------------------------------------------

    private _isExecutingAllCommands: boolean = false;
    private _singleCommandInExecution: MongoCommand | undefined;

    /**
     * Executes all Mongo commands in the given document.
     */
    public async executeAllCommands(context: IActionContext, document: vscode.TextDocument): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Please connect to a MongoDB database before running a Scrapbook command.');
        }

        const commands: MongoCommand[] = getAllCommandsFromText(document.getText());
        if (!commands.length) {
            void vscode.window.showInformationMessage('No commands found in this document.');
            return;
        }

        this.setExecutingAllCommandsFlag(true);
        try {
            const label = 'Scrapbook-run-all-results';
            const fullId = `${this.getDisplayName()}/${label}`;

            const readOnlyContent = await openReadOnlyContent({ label, fullId }, '', '.txt', {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true,
            });

            const shellRunner = await MongoShellScriptRunner.createShell(context, {
                connectionString: CredentialCache.getConnectionStringWithPassword(this.getClusterId()!),
                isEmulator: false,
            });

            try {
                for (const cmd of commands) {
                    await this.executeSingleCommand(context, cmd, readOnlyContent, shellRunner);
                }
            } finally {
                shellRunner.dispose();
            }
        } finally {
            this.setExecutingAllCommandsFlag(false);
        }
    }

    /**
     * Executes a single Mongo command defined at the specified position in the document.
     */
    public async executeCommandAtPosition(
        context: IActionContext,
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Please connect to a MongoDB database before running a Scrapbook command.');
        }

        const commands = getAllCommandsFromText(document.getText());
        const command = findCommandAtPosition(commands, position);

        const label = 'Scrapbook-run-command-results';
        const fullId = `${this.getDisplayName()}/${label}`;
        const readOnlyContent = await openReadOnlyContent({ label, fullId }, '', '.json', {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
        });

        await this.executeSingleCommand(context, command, readOnlyContent);
    }

    /**
     * Indicates whether multiple commands are being executed at once.
     */
    public isExecutingAllCommands(): boolean {
        return this._isExecutingAllCommands;
    }

    /**
     * Records the state for whether all commands are executing.
     */
    public setExecutingAllCommandsFlag(state: boolean): void {
        this._isExecutingAllCommands = state;
        this._mongoCodeLensProvider.updateCodeLens();
    }

    /**
     * Returns the command currently in execution, if any.
     */
    public getSingleCommandInExecution(): MongoCommand | undefined {
        return this._singleCommandInExecution;
    }

    /**
     * Sets or clears the command currently being executed.
     */
    public setSingleCommandInExecution(command: MongoCommand | undefined): void {
        this._singleCommandInExecution = command;
        this._mongoCodeLensProvider.updateCodeLens();
    }

    //--------------------------------------------------------------------------------
    // Internal Helpers
    //--------------------------------------------------------------------------------

    /**
     * Runs a single command against the Mongo shell. If a shell instance is not provided,
     * this method creates its own, executes the command, then disposes the shell. This
     * includes error handling for parse problems, ephemeral shell usage, and optional
     * output to a read-only content view.
     */
    private async executeSingleCommand(
        context: IActionContext,
        command: MongoCommand,
        readOnlyContent?: { append(value: string): Promise<void> },
        shellRunner?: MongoShellScriptRunner,
    ): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Not connected to any MongoDB database.');
        }

        if (command.errors?.length) {
            const firstErr = command.errors[0];
            throw new Error(
                `Unable to parse syntax near line ${firstErr.range.start.line + 1}, col ${firstErr.range.start.character + 1}: ${firstErr.message}`,
            );
        }

        this.setSingleCommandInExecution(command);
        let ephemeralShell = false;

        try {
            if (!shellRunner) {
                shellRunner = await MongoShellScriptRunner.createShell(context, {
                    connectionString: CredentialCache.getConnectionStringWithPassword(this.getClusterId()!),
                    isEmulator: false,
                });
                ephemeralShell = true;
            }

            const result = await shellRunner.executeScript(command.text);
            if (!result) {
                throw new Error('No result returned from the MongoDB shell.');
            }

            if (readOnlyContent) {
                await readOnlyContent.append(result + EOL + EOL);
            } else {
                const fallbackLabel = 'Scrapbook-results';
                const fallbackId = `${this.getDatabaseName()}/${fallbackLabel}`;
                await openReadOnlyContent({ label: fallbackLabel, fullId: fallbackId }, result, '.json', {
                    viewColumn: vscode.ViewColumn.Beside,
                    preserveFocus: true,
                });
            }
        } finally {
            this.setSingleCommandInExecution(undefined);

            if (ephemeralShell) {
                shellRunner?.dispose();
            }
        }
    }
}

// Export a single instance that the rest of your extension can import
export const MongoScrapbookService = new MongoScrapbookServiceImpl();
