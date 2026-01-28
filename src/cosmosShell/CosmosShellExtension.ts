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
import {
    LanguageClient,
    RevealOutputChannelOn,
    TransportKind,
    type LanguageClientOptions,
    type ServerOptions,
} from 'vscode-languageclient/node';
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import {
    type CosmosDBEntraIdCredential,
    type CosmosDBKeyCredential,
    type CosmosDBManagedIdentityCredential,
} from '../cosmosdb/CosmosDBCredential';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';

// Track the connection string associated with each open Cosmos Shell terminal
const terminalConnectionStrings = new Map<vscode.Terminal, string>();

export class CosmosShellExtension implements vscode.Disposable {
    private terminalChangeListeners: vscode.Disposable[] = [];

    dispose(): Promise<void> {
        // Dispose all terminal listeners
        this.terminalChangeListeners.forEach((listener) => {
            listener.dispose();
        });
        this.terminalChangeListeners = [];
        terminalConnectionStrings.clear();
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
                    // Remove the connection string for this terminal
                    terminalConnectionStrings.delete(terminal);
                }
            });

            // Store listeners for disposal
            this.terminalChangeListeners.push(openListener, closeListener);

            registerCommandWithTreeNodeUnwrapping('cosmosDB.launchCosmosShell', connectCosmosShell);
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
    const shellPath: string | undefined = SettingsService.getSetting<string>('cosmosDB.shell.path');
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
    const foundTerminal = vscode.window.terminals.find((terminal) => terminal.creationOptions.name === 'Cosmos Shell');

    const mcpEnabled = SettingsService.getSetting<boolean>('cosmosDB.shell.MCP.enabled') ?? false;
    const mcpPort = (SettingsService.getSetting<number>('cosmosDB.shell.MCP.port') ?? 6128).toString();

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
        // No connection string to store when launching without a node
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
    // Store the connection string for this terminal
    terminalConnectionStrings.set(terminal, rawConnectionString);

    goToContainer(terminal, node.model.database, node.model.container);
}

function goToContainer(terminal: vscode.Terminal, database: DatabaseDefinition, container: ContainerDefinition) {
    if (container) {
        terminal.sendText('cd "/' + database.id + '/' + container.id + '"', true);
    } else if (database) {
        terminal.sendText('cd "/' + database.id + '"', true);
    }
}

export function connectCosmosShell(_context: IActionContext, node?: NoSqlContainerResourceItem) {
    if (!node) {
        // No node selected, just launch a new shell without connection
        launchCosmosShell(_context, node);
        return;
    }

    const rawConnectionString = node.model.accountInfo.endpoint;
    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    // Find an existing Cosmos Shell terminal with the same connection string
    const existingTerminal = findTerminalByConnectionString(rawConnectionString);

    if (existingTerminal) {
        // Found a terminal with the same connection string, just navigate to the container
        existingTerminal.show();
        goToContainer(existingTerminal, node.model.database, node.model.container);
        return;
    }

    // No terminal with this connection string, launch a new one
    launchCosmosShell(_context, node);
}

/**
 * Finds an open Cosmos Shell terminal that is connected to the given connection string.
 */
function findTerminalByConnectionString(connectionString: string): vscode.Terminal | undefined {
    for (const [terminal, connStr] of terminalConnectionStrings) {
        // Verify the terminal is still open
        if (vscode.window.terminals.includes(terminal) && connStr === connectionString) {
            return terminal;
        }
    }
    return undefined;
}

function getCosmosShellCredential(node: NoSqlContainerResourceItem) {
    for (const credential of node.model.accountInfo.credentials) {
        switch (credential.type) {
            case AuthenticationMethod.accountKey: {
                // TypeScript doesn't narrow the type automatically, so we need to cast
                const keyCredential = credential as CosmosDBKeyCredential;
                return `key=${keyCredential.key}`;
            }
            case AuthenticationMethod.entraId: {
                const entraIdCredential = credential as CosmosDBEntraIdCredential;
                return `tenantId=${entraIdCredential.tenantId ?? ''}`;
            }
            case AuthenticationMethod.managedIdentity: {
                const managedIdentityCredential = credential as CosmosDBManagedIdentityCredential;
                // Note: There seems to be a bug here - you're accessing 'type' but probably want 'clientId' or similar
                return `identity=${managedIdentityCredential.clientId ?? ''}`; // or whatever the actual property name is
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
        child.execFileSync(command, ['--version'], {
            windowsHide: true,
            env: {
                ...process.env,
                // CosmosShell may use ANSI output libraries (e.g. Spectre.Console).
                // When spawned by VS Code, stdio is typically redirected which can confuse
                // terminal capability detection. Prefer a plain output mode.
                NO_COLOR: '1',
                CLICOLOR: '0',
                TERM: process.env.TERM ?? 'dumb',
            },
        });
        return true;
    } catch (err) {
        const anyErr = err as { stdout?: unknown; stderr?: unknown };
        const stdout =
            typeof anyErr?.stdout === 'string'
                ? anyErr.stdout
                : Buffer.isBuffer(anyErr?.stdout)
                  ? anyErr.stdout.toString('utf8')
                  : '';
        const stderr =
            typeof anyErr?.stderr === 'string'
                ? anyErr.stderr
                : Buffer.isBuffer(anyErr?.stderr)
                  ? anyErr.stderr.toString('utf8')
                  : '';

        // Workaround: CosmosShell may print a valid version string but still exit non-zero
        // when ANSI is not available. Treat that as installed.
        const combinedOutput = `${stdout}\n${stderr}`;
        if (/\bCosmosShell\b/i.test(combinedOutput)) {
            ext.outputChannel.appendLine(
                'warning: CosmosShell "--version" exited non-zero, but returned version output; treating as installed.',
            );
            if (stderr.trim().length > 0) {
                ext.outputChannel.appendLine(stderr.trim());
            }
            return true;
        }

        ext.outputChannel.appendLine('fail ' + err);
        ext.outputChannel.appendLine('while running "' + command + ' --version"');
        if (stdout.trim().length > 0) {
            ext.outputChannel.appendLine('stdout: ' + stdout.trim());
        }
        if (stderr.trim().length > 0) {
            ext.outputChannel.appendLine('stderr: ' + stderr.trim());
        }
        return false;
    }
}
const McpServerName = 'cosmosdb-shell-mcp-server';

export function registerMcpServer(context: vscode.ExtensionContext): void {
    try {
        if (!isCosmosShellSupportEnabled()) {
            return;
        }
        const didChangeEmitter = new vscode.EventEmitter<void>();

        const mcpPort = (SettingsService.getSetting<number>('cosmosDB.shell.MCP.port') ?? 6128).toString();

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

    void cosmosShellLanguageClient
        .start()
        .then(() => {
            ext.outputChannel.appendLine('Cosmos Shell language server started.');
        })
        .catch((err: unknown) => {
            ext.outputChannel.appendLine('Failed to start Cosmos Shell language server: ' + String(err));
        });
}
