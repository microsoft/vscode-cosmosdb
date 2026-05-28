/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point for Cosmos DB Shell support. Owns the {@link CosmosDBShellExtension}
 * activation lifecycle and the two top-level command handlers ({@link launchCosmosDBShell}
 * and {@link connectCosmosDBShell}). Heavier subsystems (install flow, MCP provider,
 * language server, terminal reuse, version cache) live in sibling modules.
 */
import { type ContainerDefinition, type DatabaseDefinition } from '@azure/cosmos';
import {
    callWithTelemetryAndErrorHandling,
    registerCommandWithTreeNodeUnwrapping,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';
import { promptToResolveMissingCosmosDBShell } from './install/installPrompts';
import {
    getCosmosDBShellCredential,
    getCosmosDBShellToken,
    getEntraIdCredential,
    getManagedIdentityCredential,
    getNodeAuthKind,
} from './nodeCredentials';
import { COSMOS_DB_SHELL_TERMINAL_NAME, getCosmosDBShellCommand, watchForEarlyExit } from './shellCommand';
import { getDetectedCosmosDBShellVersion, isCosmosDBShellInstalled } from './shellSupportCache';
import {
    buildInteractiveConnectCommand,
    buildTerminalStateForNode,
    findReusableTerminalForNode,
    terminalStates,
} from './terminalReuse';

// Re-exports preserve the existing public surface consumed by ../extension.ts.
export { registerCosmosDBShellLanguageServer } from './languageServer';
export { registerMcpServer } from './mcpProvider';
export {
    getDetectedCosmosDBShellVersion,
    invalidateCosmosDBShellSupportCache,
    isCosmosDBShellInstalled,
} from './shellSupportCache';

const DEFAULT_MCP_PORT = 6128;

export class CosmosDBShellExtension implements vscode.Disposable {
    private terminalChangeListeners: vscode.Disposable[] = [];

    dispose(): Promise<void> {
        // Dispose all terminal listeners
        this.terminalChangeListeners.forEach((listener) => {
            listener.dispose();
        });
        this.terminalChangeListeners = [];
        terminalStates.clear();
        return Promise.resolve();
    }

    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.cosmosDBShell.activate',
            (_activateContext: IActionContext) => {
                const shellInstalled: boolean = isCosmosDBShellInstalled();
                void vscode.commands.executeCommand(
                    'setContext',
                    'vscodeDatabases.cosmosDBShellSupportEnabled',
                    shellInstalled,
                );

                // Initialize terminal context on activation
                this.updateCosmosDBShellTerminalContext();

                // Watch for terminal open events
                const openListener = vscode.window.onDidOpenTerminal((terminal) => {
                    // Check if it's a Cosmos DB Shell terminal
                    if (terminal.name === COSMOS_DB_SHELL_TERMINAL_NAME) {
                        this.updateCosmosDBShellTerminalContext();
                    }
                });

                // Watch for terminal close events
                const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
                    // Check if it was a Cosmos DB Shell terminal
                    if (terminal.name === COSMOS_DB_SHELL_TERMINAL_NAME) {
                        this.updateCosmosDBShellTerminalContext();
                        // Remove tracked launch state for this terminal
                        terminalStates.delete(terminal);
                    }
                });

                // Store listeners for disposal
                this.terminalChangeListeners.push(openListener, closeListener);

                registerCommandWithTreeNodeUnwrapping('cosmosDB.launchCosmosDBShell', connectCosmosDBShell);

                if (shellInstalled) {
                    ext.outputChannel.appendLine(`Cosmos DB Shell Extension: activated.`);
                } else {
                    ext.outputChannel.appendLine(`Cosmos DB Shell Extension: deactivated.`);
                }
            },
        );
    }

    private updateCosmosDBShellTerminalContext(): void {
        const hasCosmosDBShellTerminal = vscode.window.terminals.some(
            (terminal) => terminal.name === COSMOS_DB_SHELL_TERMINAL_NAME,
        );
        void vscode.commands.executeCommand(
            'setContext',
            'vscodeDatabases.cosmosDBShellTerminalOpen',
            hasCosmosDBShellTerminal,
        );
        ext.outputChannel.appendLine(
            `Cosmos DB Shell terminal context updated: ${hasCosmosDBShellTerminal ? 'open' : 'closed'}`,
        );
    }
}

export async function launchCosmosDBShell(context: IActionContext, node?: NoSqlContainerResourceItem) {
    const shellInstalled: boolean = isCosmosDBShellInstalled();

    // Telemetry: capture launch-shape signals as early as possible so they're attached even
    // when the install/credential paths bail out before a terminal is created.
    const mcpEnabled = SettingsService.getSetting<boolean>('cosmosDB.shell.MCP.enabled') ?? false;
    const mcpPortSetting = SettingsService.getSetting<number>('cosmosDB.shell.MCP.port');
    const mcpPort = (mcpPortSetting ?? DEFAULT_MCP_PORT).toString();
    const shellPathSetting = SettingsService.getSetting<string>('cosmosDB.shell.path');
    context.telemetry.properties.shellInstalled = String(shellInstalled);
    context.telemetry.properties.shellPathCustom = String(!!shellPathSetting?.trim());
    context.telemetry.properties.mcpEnabled = String(mcpEnabled);
    context.telemetry.properties.mcpPortDefault = String(
        mcpPortSetting === undefined || mcpPortSetting === DEFAULT_MCP_PORT,
    );
    context.telemetry.properties.authKind = node ? getNodeAuthKind(node) : 'none';
    context.telemetry.properties.hasNode = String(!!node);
    context.telemetry.properties.containerScoped = String(!!node?.model.container);
    context.telemetry.properties.terminalReused = 'false';

    if (!shellInstalled) {
        await promptToResolveMissingCosmosDBShell(context, node, launchCosmosDBShell);
        return;
    }

    const command = getCosmosDBShellCommand();
    const foundTerminal = vscode.window.terminals.find(
        (terminal) => terminal.creationOptions.name === COSMOS_DB_SHELL_TERMINAL_NAME,
    );

    // If another shell terminal is already running, suppress --mcp on the new one: the
    // existing process may already own the MCP port, and we don't want to fight over it.
    const useMcp = mcpEnabled && !foundTerminal;
    context.telemetry.properties.mcpUsedThisLaunch = String(useMcp);
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
            name: COSMOS_DB_SHELL_TERMINAL_NAME,
            shellPath: command,
            shellArgs: args,
        });
        terminal.show();
        watchForEarlyExit(terminal);
        // Track the command-launched terminal with no endpoint/auth so it can be reused later
        // when the user invokes "Launch Cosmos DB Shell" from a tree node.
        terminalStates.set(terminal, { endpoint: '', authKind: 'none' });
        return;
    }

    // Skip passing credentials for emulator connections: CosmosDBShell auto-detects localhost
    // emulators and injects the well-known key. Passing COSMOSDB_SHELL_ACCOUNT_KEY would cause
    // a conflict in CosmosDBShell's credential handling when combined with the emulator
    // connection string it builds internally.
    const isEmulator = node.model.accountInfo.isEmulator;
    const cosmosDBShellCredential = isEmulator ? undefined : getCosmosDBShellCredential(node);
    const entraCredential = isEmulator ? undefined : getEntraIdCredential(node);
    const managedIdentityCredential = isEmulator ? undefined : getManagedIdentityCredential(node);
    const rawEndpoint = node.model.accountInfo.endpoint;
    if (!rawEndpoint) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the account endpoint from the selected node.'));
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
        args.push('-k', containerCommand);
    }

    ext.outputChannel.appendLine(`Launching Cosmos DB Shell: ${command} ${args.join(' ')}`);

    const env: Record<string, string> = {};
    if (cosmosDBShellCredential) {
        env['COSMOSDB_SHELL_ACCOUNT_KEY'] = cosmosDBShellCredential;
    }

    // For Entra ID, provide a pre-fetched token as fallback if VisualStudioCodeCredential fails
    if (entraCredential) {
        const fallbackToken = await getCosmosDBShellToken(entraCredential, rawEndpoint);
        context.telemetry.properties.fallbackTokenObtained = String(!!fallbackToken);
        if (fallbackToken) {
            env['COSMOSDB_SHELL_TOKEN'] = fallbackToken;
        }
    }

    const terminal: vscode.Terminal = vscode.window.createTerminal({
        name: COSMOS_DB_SHELL_TERMINAL_NAME,
        shellPath: command,
        shellArgs: args,
        env: Object.keys(env).length > 0 ? env : undefined,
    });

    terminal.show();
    watchForEarlyExit(terminal);
    // Record how this process was launched so future reuse decisions know which env vars
    // (e.g. COSMOSDB_SHELL_ACCOUNT_KEY / COSMOSDB_SHELL_TOKEN) are baked in.
    terminalStates.set(terminal, buildTerminalStateForNode(node));
}

function getGoToContainerCommand(database: DatabaseDefinition, container: ContainerDefinition): string | undefined {
    if (container) {
        return `cd "/${database.id}/${container.id}"`;
    } else if (database) {
        return `cd "/${database.id}"`;
    }
    return undefined;
}

export async function connectCosmosDBShell(context: IActionContext, node?: NoSqlContainerResourceItem) {
    // Attach the detected Cosmos DB Shell version to the auto-emitted
    // `cosmosDB.launchCosmosDBShell` telemetry event. Calling this here covers both the
    // reuse path below and the fall-through to `launchCosmosDBShell`.
    context.telemetry.properties.shellVersion = getDetectedCosmosDBShellVersion() ?? 'unknown';
    context.telemetry.properties.shellInstalled = String(isCosmosDBShellInstalled());
    context.telemetry.properties.shellPathCustom = String(
        !!SettingsService.getSetting<string>('cosmosDB.shell.path')?.trim(),
    );
    context.telemetry.properties.mcpEnabled = String(
        SettingsService.getSetting<boolean>('cosmosDB.shell.MCP.enabled') ?? false,
    );
    const mcpPortSetting = SettingsService.getSetting<number>('cosmosDB.shell.MCP.port');
    context.telemetry.properties.mcpPortDefault = String(
        mcpPortSetting === undefined || mcpPortSetting === DEFAULT_MCP_PORT,
    );
    context.telemetry.properties.hasNode = String(!!node);
    context.telemetry.properties.containerScoped = String(!!node?.model.container);
    context.telemetry.properties.authKind = node ? getNodeAuthKind(node) : 'none';
    context.telemetry.properties.terminalReused = 'false';
    context.telemetry.properties.mcpUsedThisLaunch = 'false';

    if (!node) {
        // No node selected, just launch a new shell without connection.
        await launchCosmosDBShell(context, node);
        return;
    }

    const rawEndpoint = node.model.accountInfo.endpoint;
    if (!rawEndpoint) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the account endpoint from the selected node.'));
        return;
    }

    // Try to reuse an existing Cosmos DB Shell terminal whose launch-time env credentials
    // are compatible with what this node needs. If none qualifies, fall through to launch a
    // fresh shell so the right env vars can be baked into the new process.
    const reusable = findReusableTerminalForNode(node);
    if (reusable) {
        const { terminal } = reusable;
        context.telemetry.properties.terminalReused = 'true';
        terminal.show();
        // Always re-issue `connect` before navigating: the shell may have been disconnected
        // by the user, or previously associated with a different account on a prior reuse.
        terminal.sendText(buildInteractiveConnectCommand(node, rawEndpoint), true);
        const containerCommand = getGoToContainerCommand(node.model.database, node.model.container);
        if (containerCommand) {
            terminal.sendText(containerCommand, true);
        }
        // Update tracked state to reflect the now-active node.
        terminalStates.set(terminal, buildTerminalStateForNode(node));
        return;
    }

    // No reusable terminal (none open, or a different launch-time env is required).
    await launchCosmosDBShell(context, node);
}
