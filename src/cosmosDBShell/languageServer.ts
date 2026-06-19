/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Starts the Cosmos DB Shell language server (LSP over stdio) using the same CosmosDBShell
 * binary that powers the interactive terminal, invoked with `--lsp`.
 */
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import {
    LanguageClient,
    RevealOutputChannelOn,
    TransportKind,
    type LanguageClientOptions,
    type ServerOptions,
} from 'vscode-languageclient/node';
import { ext } from '../extensionVariables';
import { getCosmosDBShellCommand } from './shellCommand';
import { isCosmosDBShellInstalled } from './shellSupportCache';

let cosmosDBShellLanguageClient: LanguageClient | undefined;

export function registerCosmosDBShellLanguageServer(context: vscode.ExtensionContext) {
    if (cosmosDBShellLanguageClient || !isCosmosDBShellInstalled()) {
        return;
    }

    // Path to the LSP server executable
    const command = getCosmosDBShellCommand();
    // Adjust argument form depending on the tool's expectation (--lsp vs -lsp)
    const serverArgs = ['--lsp'];

    const serverOptions: ServerOptions = {
        run: {
            command,
            args: serverArgs,
            transport: TransportKind.stdio,
        },
        debug: {
            command,
            args: serverArgs,
            transport: TransportKind.stdio,
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'cosmosdbshell' }],
        synchronize: {
            // Watch for related files (adjust pattern as needed)
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{csh}'),
        },
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        progressOnInitialization: true,
        outputChannelName: l10n.t('Cosmos DB Shell Language Server'),
        initializationOptions: {
            // Place any feature flags or user settings you want to pass through:
            // example: telemetry: true
        },
        middleware: {
            // Add middleware hooks if needed (e.g. logging, modifications)
        },
    };

    cosmosDBShellLanguageClient = new LanguageClient(
        'cosmosDBShellLanguageServer',
        l10n.t('Cosmos DB Shell Language Server'),
        serverOptions,
        clientOptions,
    );

    context.subscriptions.push({
        dispose: async () => {
            if (cosmosDBShellLanguageClient) {
                try {
                    await cosmosDBShellLanguageClient.stop();
                } catch (error) {
                    console.error('Failed to stop the Cosmos DB Shell language client:', error);
                }
                cosmosDBShellLanguageClient = undefined;
            }
        },
    });

    void cosmosDBShellLanguageClient
        .start()
        .then(() => {
            ext.outputChannel.appendLine('Cosmos DB Shell language server started.');
        })
        .catch((err: unknown) => {
            ext.outputChannel.appendLine('Failed to start Cosmos DB Shell language server: ' + String(err));
        });
}
