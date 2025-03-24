/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openReadOnlyContent, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { EOL } from 'os';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type ClusterModel } from '../../tree/documentdb/ClusterModel';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';
import { type DatabaseItemModel } from '../ClustersClient';
import { CredentialCache } from '../CredentialCache';
import { type MongoCommand } from './MongoCommand';
import { findCommandAtPosition, getAllCommandsFromText } from './ScrapbookHelpers';
import { ShellScriptRunner } from './ShellScriptRunner';
import { MongoCodeLensProvider } from './services/MongoCodeLensProvider';

export class ScrapbookServiceImpl {
    //--------------------------------------------------------------------------------
    // Connection Management
    //--------------------------------------------------------------------------------

    private _cluster: ClusterModel | undefined;
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
    public async setConnectedCluster(cluster: ClusterModel, database: DatabaseItemModel) {
        // Update information
        this._cluster = cluster;
        this._database = database;
        this._mongoCodeLensProvider.updateCodeLens();

        // Update the Language Client/Server
        // The language server needs credentials to connect to the cluster..
        await ext.mongoLanguageClient.connect(
            CredentialCache.getConnectionStringWithPassword(this._cluster.id),
            this._database.name,
            cluster.emulatorConfiguration,
        );
    }

    /**
     * Clears the current connection.
     */
    public async clearConnection() {
        this._cluster = undefined;
        this._database = undefined;
        this._mongoCodeLensProvider.updateCodeLens();
        await ext.mongoLanguageClient.disconnect();
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
     *
     * Note: This method will call use(<database>) before executing the commands to
     * ensure that the commands are run in the correct database. It's done for backwards
     * compatibility with the previous behavior.
     */
    public async executeAllCommands(context: IActionContext, document: vscode.TextDocument): Promise<void> {
        if (!this.isConnected()) {
            throw new Error(l10n.t('Please connect to a MongoDB database before running a Scrapbook command.'));
        }

        const commands: MongoCommand[] = getAllCommandsFromText(document.getText());
        if (!commands.length) {
            void vscode.window.showInformationMessage(l10n.t('No commands found in this document.'));
            return;
        }

        this.setExecutingAllCommandsFlag(true);
        try {
            const label = 'Scrapbook-run-all-results';
            const fullId = `${this.getDisplayName()}/${label}`;

            const readOnlyContent = await openReadOnlyContent({ label, fullId }, '', '.json', {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true,
            });

            const shellRunner = await ShellScriptRunner.createShell(context, {
                connectionString: CredentialCache.getConnectionStringWithPassword(this.getClusterId()!),
                emulatorConfiguration: CredentialCache.getEmulatorConfiguration(this.getClusterId()!),
            });

            try {
                // preselect the database for the user
                // this is done for backwards compatibility with the previous behavior
                await shellRunner.executeScript(`use(\`${ScrapbookService.getDatabaseName()}\`)`);

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
     *
     * Note: This method will call use(<database>) before executing the command to
     * ensure that the command are is in the correct database. It's done for backwards
     * compatibility with the previous behavior.
     */
    public async executeCommandAtPosition(
        context: IActionContext,
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<void> {
        if (!this.isConnected()) {
            throw new Error(l10n.t('Please connect to a MongoDB database before running a Scrapbook command.'));
        }

        const commands = getAllCommandsFromText(document.getText());
        const command = findCommandAtPosition(commands, position);

        const label = 'Scrapbook-run-command-results';
        const fullId = `${this.getDisplayName()}/${label}`;
        const readOnlyContent = await openReadOnlyContent({ label, fullId }, '', '.json', {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
        });

        await this.executeSingleCommand(context, command, readOnlyContent, undefined, this.getDatabaseName());
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
        shellRunner?: ShellScriptRunner,
        preselectedDatabase?: string, // this will run the 'use <database>' command before the actual command.
    ): Promise<void> {
        if (!this.isConnected()) {
            throw new Error(l10n.t('Not connected to any MongoDB database.'));
        }

        if (command.errors?.length) {
            const firstErr = command.errors[0];
            throw new Error(
                l10n.t('Unable to parse syntax near line {line}, col {column}: {message}', {
                    line: firstErr.range.start.line + 1,
                    column: firstErr.range.start.character + 1,
                    message: firstErr.message,
                }),
            );
        }

        this.setSingleCommandInExecution(command);
        let ephemeralShell = false;

        try {
            if (!shellRunner) {
                shellRunner = await ShellScriptRunner.createShell(context, {
                    connectionString: CredentialCache.getConnectionStringWithPassword(this.getClusterId()!),
                    emulatorConfiguration: CredentialCache.getEmulatorConfiguration(
                        this.getClusterId()!,
                    ) as EmulatorConfiguration,
                });
                ephemeralShell = true;
            }

            if (preselectedDatabase) {
                await shellRunner.executeScript(`use(\`${preselectedDatabase}\`)`);
            }

            const result = await shellRunner.executeScript(command.text);
            if (!result) {
                throw new Error(l10n.t('No result returned from the MongoDB shell.'));
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
export const ScrapbookService = new ScrapbookServiceImpl();
