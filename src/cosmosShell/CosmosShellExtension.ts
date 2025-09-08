/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable import/no-internal-modules */

/**
 * entry-point for mongoClusters-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to mongoClusters-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import { type ContainerDefinition } from '@azure/cosmos/dist/commonjs/client/Container/ContainerDefinition';
import { type DatabaseDefinition } from '@azure/cosmos/dist/commonjs/client/Database/DatabaseDefinition';
import {
    callWithTelemetryAndErrorHandling,
    registerCommandWithTreeNodeUnwrapping,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as child from 'child_process';
import * as vscode from 'vscode';
import { RevealOutputChannelOn } from 'vscode-languageclient';
import {
    LanguageClient,
    TransportKind,
    type LanguageClientOptions,
    type ServerOptions,
} from 'vscode-languageclient/node';
import {
    AuthenticationMethod,
    type CosmosDBEntraIdCredential,
    type CosmosDBKeyCredential,
    type CosmosDBManagedIdentityCredential,
} from '../cosmosdb/getCosmosClient';
import { ext } from '../extensionVariables';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';

export class CosmosShellExtension implements vscode.Disposable {
    private terminalChangeListeners: vscode.Disposable[] = [];

    dispose(): Promise<void> {
        // Dispose all terminal listeners
        this.terminalChangeListeners.forEach((listener) => {
            listener.dispose();
        });
        this.terminalChangeListeners = [];
        return Promise.resolve();
    }

    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.cosmosShell.activate', (_activateContext: IActionContext) => {
            const isCosmosShellInstalled: boolean = isCosmosShellSupportEnabled();
            vscode.commands.executeCommand(
                'setContext',
                'vscodeDatabases.cosmosShellSupportEnabled',
                isCosmosShellInstalled,
            );

            // Initialize terminal context on activation
            this.updateCosmosShellTerminalContext();

            // Watch for terminal open events
            const openListener = vscode.window.onDidOpenTerminal((terminal) => {
                // Check if it's a Cosmos Shell terminal
                if (terminal.name === 'Cosmos Shell') {
                    this.updateCosmosShellTerminalContext();
                }
            });

            // Watch for terminal close events
            const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
                // Check if it was a Cosmos Shell terminal
                if (terminal.name === 'Cosmos Shell') {
                    this.updateCosmosShellTerminalContext();
                }
            });

            // Store listeners for disposal
            this.terminalChangeListeners.push(openListener, closeListener);

            registerCommandWithTreeNodeUnwrapping('cosmosDB.launchCosmosShell', launchCosmosShell);
            registerCommandWithTreeNodeUnwrapping('cosmosDB.connectCosmosShell', connectCosmosShell);

            if (isCosmosShellInstalled) {
                ext.outputChannel.appendLine(`Cosmos Shell Extension: activated.`);
            } else {
                ext.outputChannel.appendLine(`Cosmos Shell Extension: deactivated.`);
            }
        });
    }

    private updateCosmosShellTerminalContext(): void {
        const hasCosmosShellTerminal = vscode.window.terminals.some((terminal) => terminal.name === 'Cosmos Shell');
        vscode.commands.executeCommand('setContext', 'vscodeDatabases.cosmosShellTerminalOpen', hasCosmosShellTerminal);
        ext.outputChannel.appendLine(
            `Cosmos Shell terminal context updated: ${hasCosmosShellTerminal ? 'open' : 'closed'}`,
        );
    }
}

// Create a singleton instance to access the context updater
//const cosmosShellExt = new CosmosShellExtension();

function getCosmosShellCommand(): string {
    const config = vscode.workspace.getConfiguration();
    const shellPath: string | undefined = config.get('cosmosDB.shell.path');
    return shellPath || 'CosmosShell';
}

function updateTerminalContext(): void {
    const hasCosmosShellTerminal = vscode.window.terminals.some((terminal) => terminal.name === 'Cosmos Shell');
    vscode.commands.executeCommand('setContext', 'vscodeDatabases.cosmosShellTerminalOpen', hasCosmosShellTerminal);
}

export function launchCosmosShell(_context: IActionContext, node?: NoSqlContainerResourceItem) {
    const isCosmosShellInstalled: boolean = isCosmosShellSupportEnabled();

    if (!isCosmosShellInstalled) {
        const settings = l10n.t('Settings');
        void vscode.window
            .showErrorMessage(
                l10n.t(
                    'Cosmos Shell is not installed or not found in PATH. Please install Cosmos Shell or configure its path in settings.',
                ),
                settings,
            )
            .then((selection) => {
                if (selection === settings) {
                    void vscode.commands.executeCommand(
                        'vscode.open',
                        vscode.Uri.parse('vscode://settings/cosmosDB.shell.path'),
                    );
                }
            });
        return;
    }

    const command = getCosmosShellCommand();
    const foundTerminal = vscode.window.terminals.find((terminal) => terminal.name === 'Cosmos Shell');

    const config = vscode.workspace.getConfiguration();

    const mcpEnabled = config.get<boolean>('cosmosDB.shell.mcp.enabled') ?? true;
    const mcpPort = (config.get<number>('cosmosDB.shell.mcp.port') ?? 6128).toString();

    const useMcp = mcpEnabled && !foundTerminal;
    ext.outputChannel.appendLine(`MCP enabled: ${useMcp}, MCP port: ${mcpPort}`);
    let args: string[];
    if (!node) {
        if (useMcp) {
            args = ['--mcp', '--mcp-port', mcpPort];
        } else {
            args = [];
        }
        const terminal: vscode.Terminal = vscode.window.createTerminal('Cosmos Shell', command, args);
        terminal.show();
        // Update context after creating terminal
        updateTerminalContext();
        return;
    }

    const cosmosShellCredential = getCosmosShellCredential(node);
    const rawConnectionString = node.model.accountInfo.endpoint;
    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    if (useMcp) {
        args = ['--mcp', '--mcp-port', mcpPort, '--connect', rawConnectionString];
    } else {
        args = ['--connect', rawConnectionString];
    }

    const terminal: vscode.Terminal = vscode.window.createTerminal({
        name: 'Cosmos Shell',
        shellPath: command,
        shellArgs: args,
        env: cosmosShellCredential ? { COSMOS_SHELL_CREDENTIAL: cosmosShellCredential } : undefined,
    });

    terminal.show();
    // Update context after creating terminal
    updateTerminalContext();

    goToContainer(terminal, node.model.database, node.model.container);
}

function goToContainer(terminal: vscode.Terminal, database: DatabaseDefinition, container: ContainerDefinition) {
    if (container) {
        terminal.sendText('cd "' + database.id + '/' + container.id + '"', true);
    } else if (database) {
        terminal.sendText('cd "' + database.id + '"', true);
    }
}

export function connectCosmosShell(_context: IActionContext, node?: NoSqlContainerResourceItem) {
    // Find an existing Cosmos Shell terminal
    const foundTerminal = vscode.window.terminals.find((terminal) => terminal.name === 'Cosmos Shell');

    if (!foundTerminal) {
        void vscode.window
            .showWarningMessage(
                l10n.t('No active Cosmos Shell terminal found. Please launch Cosmos Shell first.'),
                l10n.t('Launch Cosmos Shell'),
            )
            .then((selection) => {
                if (selection === l10n.t('Launch Cosmos Shell')) {
                    launchCosmosShell(_context, node);
                }
            });
        return;
    }

    if (!node) {
        void vscode.window.showErrorMessage(l10n.t('Please select a Cosmos DB resource to connect to.'));
        return;
    }

    const rawConnectionString = node.model.accountInfo.endpoint;
    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    const cosmosShellCredential = getCosmosShellCredential(node);

    foundTerminal.show();
    foundTerminal.sendText(`connect "${rawConnectionString}"`, true);

    if (cosmosShellCredential) {
        ext.outputChannel.appendLine(
            `Note: Credential information (${cosmosShellCredential}) needs to be set before connecting.`,
        );
    }
    goToContainer(foundTerminal, node.model.database, node.model.container);
    void vscode.window.showInformationMessage(l10n.t('Connection command sent to Cosmos Shell terminal.'));
}

function getCosmosShellCredential(node: NoSqlContainerResourceItem) {
    for (const credential of node.model.accountInfo.credentials) {
        switch (credential.type) {
            case AuthenticationMethod.accountKey: {
                const keyId = credential as CosmosDBKeyCredential;
                return `key=${keyId.key}`;
            }
            case AuthenticationMethod.entraId: {
                const tenantId = credential as CosmosDBEntraIdCredential;
                return `tenantId=${tenantId.tenantId}`;
            }
            case AuthenticationMethod.managedIdentity: {
                const clientId = credential as CosmosDBManagedIdentityCredential;
                return `identity=${clientId.type}`;
            }
            default:
                continue;
        }
    }
    return undefined;
}

/**
 * Determines if CosmosShell is installed.
 *
 * @returns true, if CosmosShell is installed, false otherwise.
 */
export function isCosmosShellSupportEnabled(): boolean {
    const command = getCosmosShellCommand();
    try {
        child.execFileSync(command, ['--version']);
        return true;
    } catch (err) {
        ext.outputChannel.appendLine('fail ' + err);
        ext.outputChannel.appendLine('while running "' + command + ' --version"');
        return false;
    }
}
const McpServerName = 'cosmosdb-shell-mcp-server';

export function registerMcpServer(context: vscode.ExtensionContext): void {
    registerCosmosShellLanguageServer(context);
    try {
        const didChangeEmitter = new vscode.EventEmitter<void>();
        const config = vscode.workspace.getConfiguration();
        const mcpPort = (config.get<number>('cosmosDB.shell.mcp.port') ?? 6128).toString();

        context.subscriptions.push(
            vscode.lm.registerMcpServerDefinitionProvider('cosmosShellMcpProvider', {
                onDidChangeMcpServerDefinitions: didChangeEmitter.event,
                provideMcpServerDefinitions: () => {
                    return [
                        new vscode.McpHttpServerDefinition(
                            McpServerName,
                            vscode.Uri.parse(`http://localhost:${mcpPort}`),
                            {
                                API_VERSION: '1.0.0',
                            },
                            '1.0.0',
                        ),
                    ];
                },
                resolveMcpServerDefinition: (server: vscode.McpServerDefinition) => {
                    if (server.label === McpServerName) {
                        // Get the API key from the user, e.g. using vscode.window.showInputBox
                        // Update the server definition with the API key
                    }

                    // Return undefined to indicate that the server should not be started or throw an error
                    //twIf there is a pending toolc all, the editor will cancel it and return an error message
                    // to the language model.
                    return server;
                },
            }),
        );
    } catch (err) {
        ext.outputChannel.appendLine('error while registering MCP server: ' + err);
    }
}
let cosmosShellLanguageClient: LanguageClient | undefined;

export function registerCosmosShellLanguageServer(context: vscode.ExtensionContext) {
    if (cosmosShellLanguageClient || !isCosmosShellSupportEnabled()) {
        return;
    }

    // Path to your LSP server executable
    const command = getCosmosShellCommand();
    // Adjust argument form depending on the tool’s expectation (--lsp vs -lsp)
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
        documentSelector: [{ scheme: 'file', language: 'cosmosshell' }],
        synchronize: {
            // Watch for related files (adjust pattern as needed)
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{csh}'),
        },
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        progressOnInitialization: true,
        outputChannelName: l10n.t('Cosmos Shell Language Server'),
        initializationOptions: {
            // Place any feature flags or user settings you want to pass through:
            // example: telemetry: true
        },
        middleware: {
            // Add middleware hooks if needed (e.g. logging, modifications)
        },
    };

    cosmosShellLanguageClient = new LanguageClient(
        'cosmosShellLanguageServer',
        l10n.t('Cosmos Shell Language Server'),
        serverOptions,
        clientOptions,
    );

    context.subscriptions.push({
        dispose: async () => {
            if (cosmosShellLanguageClient) {
                try {
                    await cosmosShellLanguageClient.stop();
                } catch (error) {
                    console.error('Failed to stop the cosmos shell language client:', error);
                }
                cosmosShellLanguageClient = undefined;
            }
        },
    });

    cosmosShellLanguageClient
        .start()
        .then(() => {
            ext.outputChannel.appendLine('Cosmos Shell language server started.');
        })
        .catch((err) => {
            ext.outputChannel.appendLine('Failed to start Cosmos Shell language server: ' + err);
        });
}
