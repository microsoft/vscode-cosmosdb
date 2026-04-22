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
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
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
import { getAccessTokenForVSCode } from '../cosmosdb/utils/azureSessionHelper';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';
import { resolveCosmosShellCommand } from './cosmosShellCommandResolver';

// Track the connection string associated with each open Cosmos DB Shell terminal
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
                // Check if it's a Cosmos DB Shell terminal
                if (terminal.name === 'Cosmos DB Shell') {
                    this.updateCosmosShellTerminalContext();
                }
            });

            // Watch for terminal close events
            const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
                // Check if it was a Cosmos DB Shell terminal
                if (terminal.name === 'Cosmos DB Shell') {
                    this.updateCosmosShellTerminalContext();
                    // Remove the connection string for this terminal
                    terminalConnectionStrings.delete(terminal);
                }
            });

            // Store listeners for disposal
            this.terminalChangeListeners.push(openListener, closeListener);

            registerCommandWithTreeNodeUnwrapping('cosmosDB.launchCosmosShell', connectCosmosShell);

            if (isCosmosShellInstalled) {
                ext.outputChannel.appendLine(`Cosmos DB Shell Extension: activated.`);
            } else {
                ext.outputChannel.appendLine(`Cosmos DB Shell Extension: deactivated.`);
            }
        });
    }

    private updateCosmosShellTerminalContext(): void {
        const hasCosmosShellTerminal = vscode.window.terminals.some((terminal) => terminal.name === 'Cosmos DB Shell');
        vscode.commands.executeCommand('setContext', 'vscodeDatabases.cosmosShellTerminalOpen', hasCosmosShellTerminal);
        ext.outputChannel.appendLine(
            `Cosmos DB Shell terminal context updated: ${hasCosmosShellTerminal ? 'open' : 'closed'}`,
        );
    }
}

// Create a singleton instance to access the context updater
//const cosmosShellExt = new CosmosShellExtension();

function getCosmosShellCommand(): string {
    const shellPath: string | undefined = SettingsService.getSetting<string>('cosmosDB.shell.path');
    return resolveCosmosShellCommand(shellPath);
}

function isCosmosShellPathFound(): boolean {
    const shellPath: string | undefined = SettingsService.getSetting<string>('cosmosDB.shell.path');
    if (!shellPath?.trim()) {
        return false;
    }

    const trimmed = shellPath.trim();
    const unquoted =
        (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
            ? trimmed.slice(1, -1)
            : trimmed;

    try {
        return fs.existsSync(unquoted) && fs.statSync(unquoted).isFile();
    } catch {
        return false;
    }
}

/**
 * Watches for the terminal closing shortly after creation (early exit).
 * If the process exits quickly, logs the exit code and reason to the output channel.
 */
function watchForEarlyExit(terminal: vscode.Terminal): void {
    const startTime = Date.now();
    const listener = vscode.window.onDidCloseTerminal((closedTerminal) => {
        listener.dispose();
        if (closedTerminal === terminal && Date.now() - startTime < 5000) {
            const exitCode = closedTerminal.exitStatus?.code;
            const exitReason = closedTerminal.exitStatus?.reason;
            ext.outputChannel.error(
                `Cosmos DB Shell exited early.${exitCode !== undefined ? ` Exit code: ${exitCode}.` : ''}${exitReason !== undefined ? ` Reason: ${exitReason}.` : ''}`,
            );
        }
    });
}

export async function launchCosmosShell(_context: IActionContext, node?: NoSqlContainerResourceItem) {
    const isCosmosShellInstalled: boolean = isCosmosShellSupportEnabled();

    if (!isCosmosShellInstalled) {
        const settings = l10n.t('Settings');

        let msg: string;
        if (!isCosmosShellPathFound()) {
            msg = l10n.t('Cosmos DB Shell path is not found. Please configure the correct path in settings.');
        } else {
            msg = l10n.t(
                'Cosmos DB Shell is not installed or not found in PATH. Please install Cosmos DB Shell or configure its path in settings.',
            );
        }

        void vscode.window.showErrorMessage(msg, settings).then((selection) => {
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
    const foundTerminal = vscode.window.terminals.find(
        (terminal) => terminal.creationOptions.name === 'Cosmos DB Shell',
    );

    const mcpEnabled = SettingsService.getSetting<boolean>('cosmosDB.shell.MCP.enabled') ?? false;
    const mcpPort = (SettingsService.getSetting<number>('cosmosDB.shell.MCP.port') ?? 6128).toString();

    const useMcp = mcpEnabled && !foundTerminal;
    ext.outputChannel.appendLine(`MCP enabled: ${useMcp}, MCP port: ${mcpPort}`);
    let args: string[];
    if (!node) {
        if (useMcp) {
            args = ['--mcp', mcpPort];
        } else {
            args = [];
        }
        ext.outputChannel.appendLine(`Launching Cosmos DB Shell: ${command} ${args.join(' ')}`);
        const terminal: vscode.Terminal = vscode.window.createTerminal({
            name: 'Cosmos DB Shell',
            shellPath: command,
            shellArgs: args,
        });
        terminal.show();
        watchForEarlyExit(terminal);
        // No connection string to store when launching without a node
        return;
    }

    // Skip passing credentials for emulator connections: CosmosDBShell auto-detects localhost
    // emulators and injects the well-known key. Passing COSMOS_SHELL_ACCOUNT_KEY would cause
    // a conflict in CosmosDBShell's credential handling when combined with the emulator
    // connection string it builds internally.
    const isEmulator = node.model.accountInfo.isEmulator;
    const cosmosShellCredential = isEmulator ? undefined : getCosmosShellCredential(node);
    const entraCredential = isEmulator ? undefined : getEntraIdCredential(node);
    const managedIdentityCredential = isEmulator ? undefined : getManagedIdentityCredential(node);
    const rawEndpoint = node.model.accountInfo.endpoint;
    if (!rawEndpoint) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    if (useMcp) {
        args = ['--mcp', mcpPort, '--connect', rawEndpoint];
    } else {
        args = ['--connect', rawEndpoint];
    }

    // For Entra ID credentials, use VisualStudioCodeCredential in the shell
    if (entraCredential) {
        args.push('--connect-vscode-credential');
        if (entraCredential.tenantId) {
            args.push('--connect-tenant', entraCredential.tenantId);
        }
    }

    // For user-assigned managed identity, pass the client ID via CLI arg
    if (managedIdentityCredential?.clientId) {
        args.push('--connect-managed-identity', managedIdentityCredential.clientId);
    }

    const containerCommand = getGoToContainerCommand(node.model.database, node.model.container);
    if (containerCommand) {
        args.push('--k', containerCommand);
    }

    ext.outputChannel.appendLine(`Launching Cosmos DB Shell: ${command} ${args.join(' ')}`);

    const env: Record<string, string> = {};
    if (cosmosShellCredential) {
        env['COSMOS_SHELL_ACCOUNT_KEY'] = cosmosShellCredential;
    }

    // For Entra ID, provide a pre-fetched token as fallback if VisualStudioCodeCredential fails
    if (entraCredential) {
        const fallbackToken = await getCosmosShellToken(entraCredential, rawEndpoint);
        if (fallbackToken) {
            env['COSMOS_SHELL_TOKEN'] = fallbackToken;
        }
    }

    const terminal: vscode.Terminal = vscode.window.createTerminal({
        name: 'Cosmos DB Shell',
        shellPath: command,
        shellArgs: args,
        env: Object.keys(env).length > 0 ? env : undefined,
    });

    terminal.show();
    watchForEarlyExit(terminal);
    // Store the connection string for this terminal
    terminalConnectionStrings.set(terminal, rawEndpoint);
}

function getGoToContainerCommand(database: DatabaseDefinition, container: ContainerDefinition): string | undefined {
    if (container) {
        return `cd "/${database.id}/${container.id}"`;
    } else if (database) {
        return `cd "/${database.id}"`;
    }
    return undefined;
}

export async function connectCosmosShell(_context: IActionContext, node?: NoSqlContainerResourceItem) {
    if (!node) {
        // No node selected, just launch a new shell without connection
        await launchCosmosShell(_context, node);
        return;
    }

    const rawConnectionString = node.model.accountInfo.endpoint;
    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    // Find an existing Cosmos DB Shell terminal with the same connection string
    const existingTerminal = findTerminalByConnectionString(rawConnectionString);

    if (existingTerminal) {
        // Found a terminal with the same connection string, just navigate to the container
        existingTerminal.show();
        const containerCommand = getGoToContainerCommand(node.model.database, node.model.container);
        if (containerCommand) {
            existingTerminal.sendText(containerCommand, true);
        }
        return;
    }

    // No terminal with this connection string, launch a new one
    await launchCosmosShell(_context, node);
}

/**
 * Finds an open Cosmos DB Shell terminal that is connected to the given connection string.
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

function getCosmosShellCredential(node: NoSqlContainerResourceItem): string | undefined {
    const credential = node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.accountKey) as
        | CosmosDBKeyCredential
        | undefined;
    return credential?.key;
}

function getEntraIdCredential(node: NoSqlContainerResourceItem): CosmosDBEntraIdCredential | undefined {
    return node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.entraId) as
        | CosmosDBEntraIdCredential
        | undefined;
}

function getManagedIdentityCredential(node: NoSqlContainerResourceItem): CosmosDBManagedIdentityCredential | undefined {
    return node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.managedIdentity) as
        | CosmosDBManagedIdentityCredential
        | undefined;
}

/**
 * Obtains an access token from VS Code's authentication session for the Cosmos DB endpoint.
 * Used as a fallback token via COSMOS_SHELL_TOKEN if VisualStudioCodeCredential fails in the shell.
 */
async function getCosmosShellToken(
    entraCredential: CosmosDBEntraIdCredential,
    endpoint: string,
): Promise<string | undefined> {
    try {
        const endpointUrl = new URL(endpoint);
        const scope = `${endpointUrl.origin}${endpointUrl.pathname}.default`;
        const token = await getAccessTokenForVSCode(scope, entraCredential.tenantId, { createIfNone: false });
        return token?.token ?? undefined;
    } catch {
        ext.outputChannel.appendLine('Failed to obtain fallback access token for Cosmos DB Shell');
        return undefined;
    }
}

/**
 * Determines if CosmosShell is installed.
 *
 * @returns true, if CosmosShell is installed, false otherwise.
 */
export function isCosmosShellSupportEnabled(): boolean {
    const command = getCosmosShellCommand();
    const cached = cosmosShellSupportCache.get(command);
    if (cached !== undefined) {
        return cached;
    }
    const result = detectCosmosShellSupport(command);
    cosmosShellSupportCache.set(command, result);
    return result;
}

/**
 * Clears the cached result of {@link isCosmosShellSupportEnabled}.
 * Call this when the shell path configuration changes or the binary may have been installed/removed.
 */
export function invalidateCosmosShellSupportCache(): void {
    cosmosShellSupportCache.clear();
}

const cosmosShellSupportCache = new Map<string, boolean>();

function detectCosmosShellSupport(command: string): boolean {
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
        if (/\bCosmos(?:DB)?Shell\b/i.test(combinedOutput)) {
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
const McpServerName = 'Azure Cosmos DB Shell';

function isPortReachable(port: string): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(2000);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(parseInt(port, 10), '127.0.0.1');
    });
}

function isMcpShellServer(port: string): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/sse`, { timeout: 3000 }, (res) => {
            const contentType = res.headers['content-type'] ?? '';
            res.destroy();
            resolve(contentType.startsWith('text/event-stream'));
        });
        req.once('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.once('error', () => {
            resolve(false);
        });
    });
}

function waitForPort(
    port: string,
    retries: number,
    delayMs: number,
    token: vscode.CancellationToken,
): Promise<boolean> {
    return new Promise((resolve) => {
        let attempt = 0;
        const tokenListener = token.onCancellationRequested(() => {
            tokenListener.dispose();
            resolve(false);
        });

        const poll = async () => {
            if (token.isCancellationRequested) {
                tokenListener.dispose();
                resolve(false);
                return;
            }
            if (await isPortReachable(port)) {
                tokenListener.dispose();
                resolve(true);
                return;
            }
            attempt++;
            if (attempt >= retries) {
                tokenListener.dispose();
                resolve(false);
                return;
            }
            setTimeout(() => void poll(), delayMs);
        };

        void poll();
    });
}

function showMcpSettingsNotification(message: string, settingKey: string): void {
    const settingsLabel = l10n.t('Settings');
    void vscode.window.showWarningMessage(message, settingsLabel).then((selection) => {
        if (selection === settingsLabel) {
            void vscode.commands.executeCommand('workbench.action.openSettings', settingKey);
        }
    });
}

async function resolveMcpServer(
    server: vscode.McpServerDefinition,
    mcpPort: string,
    token: vscode.CancellationToken,
): Promise<vscode.McpServerDefinition> {
    if (server.label !== McpServerName) {
        return server;
    }

    const portReachable = await isPortReachable(mcpPort);

    if (portReachable) {
        const isShell = await isMcpShellServer(mcpPort);
        if (isShell) {
            return server;
        }
        showMcpSettingsNotification(
            l10n.t('Port {0} is in use by another process. Configure a different MCP port in settings.', mcpPort),
            'cosmosDB.shell.MCP.port',
        );
        throw new Error(
            `Port ${mcpPort} is in use by another process that is not the Cosmos DB Shell MCP server. Configure a different port via the "cosmosDB.shell.MCP.port" setting.`,
        );
    }

    if (!isCosmosShellSupportEnabled()) {
        showMcpSettingsNotification(
            l10n.t(
                'Cosmos DB Shell is not installed or not found in PATH. Please install Cosmos DB Shell or configure its path in settings.',
            ),
            'cosmosDB.shell.path',
        );
        throw new Error(
            'Cosmos DB Shell binary is not installed or not found. The user must install it or configure the "cosmosDB.shell.path" setting.',
        );
    }

    const mcpEnabled = SettingsService.getSetting<boolean>('cosmosDB.shell.MCP.enabled') ?? false;

    if (!mcpEnabled) {
        showMcpSettingsNotification(
            l10n.t('Cosmos DB Shell MCP is not enabled. Enable it in settings to auto-start the shell.'),
            'cosmosDB.shell.MCP.enabled',
        );
        throw new Error(
            'Cosmos DB Shell MCP is not enabled. The user must enable the "cosmosDB.shell.MCP.enabled" setting and restart the MCP server.',
        );
    }

    const existingTerminal = vscode.window.terminals.find((t) => t.creationOptions.name === 'Cosmos DB Shell');

    if (existingTerminal) {
        void vscode.window.showWarningMessage(
            l10n.t('The running Cosmos DB Shell was started without MCP. Please close it and try again.'),
        );
        throw new Error(
            'A Cosmos DB Shell terminal is already running without MCP support. The user must close it and try again.',
        );
    }

    ext.outputChannel.appendLine('MCP resolve: launching Cosmos DB Shell with --mcp');
    await vscode.commands.executeCommand('cosmosDB.launchCosmosShell');

    const ready = await waitForPort(mcpPort, 10, 1000, token);
    if (!ready) {
        ext.outputChannel.appendLine('MCP resolve: Cosmos DB Shell MCP server did not become reachable in time');
        void vscode.window.showWarningMessage(
            l10n.t('Cosmos DB Shell MCP server did not start in time. Check the terminal for errors.'),
        );
        throw new Error(
            'Cosmos DB Shell MCP server did not start in time. The user should check the Cosmos DB Shell terminal for errors.',
        );
    }

    return server;
}

export function registerMcpServer(context: vscode.ExtensionContext): void {
    try {
        const didChangeEmitter = new vscode.EventEmitter<void>();

        const getMcpPort = (): string =>
            (SettingsService.getSetting<number>('cosmosDB.shell.MCP.port') ?? 6128).toString();

        context.subscriptions.push(
            vscode.lm.registerMcpServerDefinitionProvider('cosmosDbShellMcpProvider', {
                onDidChangeMcpServerDefinitions: didChangeEmitter.event,
                provideMcpServerDefinitions: () => {
                    const mcpPort = getMcpPort();
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
                resolveMcpServerDefinition: (server: vscode.McpServerDefinition, token: vscode.CancellationToken) => {
                    return resolveMcpServer(server, getMcpPort(), token);
                },
            }),
        );

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('cosmosDB.shell.path')) {
                    invalidateCosmosShellSupportCache();
                }
                if (
                    event.affectsConfiguration('cosmosDB.shell.MCP.port') ||
                    event.affectsConfiguration('cosmosDB.shell.MCP.enabled') ||
                    event.affectsConfiguration('cosmosDB.shell.path')
                ) {
                    didChangeEmitter.fire();
                }
            }),
        );

        context.subscriptions.push(didChangeEmitter);
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
        outputChannelName: l10n.t('Cosmos DB Shell Language Server'),
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
        l10n.t('Cosmos DB Shell Language Server'),
        serverOptions,
        clientOptions,
    );

    context.subscriptions.push({
        dispose: async () => {
            if (cosmosShellLanguageClient) {
                try {
                    await cosmosShellLanguageClient.stop();
                } catch (error) {
                    console.error('Failed to stop the Cosmos DB Shell language client:', error);
                }
                cosmosShellLanguageClient = undefined;
            }
        },
    });

    void cosmosShellLanguageClient
        .start()
        .then(() => {
            ext.outputChannel.appendLine('Cosmos DB Shell language server started.');
        })
        .catch((err: unknown) => {
            ext.outputChannel.appendLine('Failed to start Cosmos DB Shell language server: ' + String(err));
        });
}
