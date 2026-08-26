/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point for Cosmos DB Shell support. Owns the {@link CosmosDBShellExtension}
 * activation lifecycle and the {@link launchCosmosDBShell} command handler. Heavier
 * subsystems (install flow, MCP provider, language server, version cache) live in
 * sibling modules.
 */
import {
    callWithTelemetryAndErrorHandling,
    registerCommandWithTreeNodeUnwrapping,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';
import {
    COMMAND_LAUNCH_COSMOS_DB_SHELL,
    COSMOS_DB_SHELL_TERMINAL_NAME,
    DEFAULT_MCP_PORT,
    SETTING_MCP_ENABLED,
    SETTING_MCP_PORT,
    SETTING_SHELL_PATH,
} from './constants';
import { promptToResolveMissingCosmosDBShell, promptToUpdateCosmosDBShell } from './install/installPrompts';
import {
    getCosmosDBShellCredential,
    getCosmosDBShellToken,
    getEntraIdCredential,
    getManagedIdentityCredential,
    getNodeAuthKind,
} from './nodeCredentials';
import { getCosmosDBShellCommand, watchForEarlyExit } from './shellCommand';
import { type CosmosDBShellLaunchNode } from './shellLaunchNode';
import {
    getDetectedCosmosDBShellVersion,
    isCosmosDBShellInstalled,
    isCosmosDBShellVersionSupported,
} from './shellSupportCache';
import { getStartupLocationArguments } from './startupLocationArguments';

// Re-exports preserve the existing public surface consumed by ../extension.ts.
export { registerCosmosDBShellLanguageServer } from './languageServer';
export { registerMcpServer } from './mcpProvider';
export {
    getDetectedCosmosDBShellVersion,
    invalidateCosmosDBShellSupportCache,
    isCosmosDBShellInstalled,
} from './shellSupportCache';

export class CosmosDBShellExtension implements vscode.Disposable {
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
                    if (terminal.creationOptions.name === COSMOS_DB_SHELL_TERMINAL_NAME) {
                        this.updateCosmosDBShellTerminalContext();
                    }
                });

                // Watch for terminal close events
                const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
                    // Check if it was a Cosmos DB Shell terminal
                    if (terminal.creationOptions.name === COSMOS_DB_SHELL_TERMINAL_NAME) {
                        this.updateCosmosDBShellTerminalContext();
                    }
                });

                // Store listeners for disposal
                this.terminalChangeListeners.push(openListener, closeListener);

                registerCommandWithTreeNodeUnwrapping(COMMAND_LAUNCH_COSMOS_DB_SHELL, launchCosmosDBShell);

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
            (terminal) => terminal.creationOptions.name === COSMOS_DB_SHELL_TERMINAL_NAME,
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

export async function launchCosmosDBShell(context: IActionContext, node?: CosmosDBShellLaunchNode) {
    const shellInstalled: boolean = isCosmosDBShellInstalled();
    const shellVersionSupported = isCosmosDBShellVersionSupported();
    const startupLocationArgs = node ? getStartupLocationArguments(node.model.database, node.model.container) : [];

    // Telemetry: capture launch-shape signals as early as possible so they're attached even
    // when the install/credential paths bail out before a terminal is created.
    const mcpEnabled = SettingsService.getSetting<boolean>(SETTING_MCP_ENABLED) ?? false;
    const mcpPortSetting = SettingsService.getSetting<number>(SETTING_MCP_PORT);
    const mcpPort = (mcpPortSetting ?? DEFAULT_MCP_PORT).toString();
    const shellPathSetting = SettingsService.getSetting<string>(SETTING_SHELL_PATH);
    context.telemetry.properties.shellInstalled = String(shellInstalled);
    context.telemetry.properties.shellVersion = getDetectedCosmosDBShellVersion() ?? 'unknown';
    context.telemetry.properties.shellVersionSupported = String(shellVersionSupported);
    context.telemetry.properties.shellPathCustom = String(!!shellPathSetting?.trim());
    context.telemetry.properties.mcpEnabled = String(mcpEnabled);
    context.telemetry.properties.mcpPortDefault = String(
        mcpPortSetting === undefined || mcpPortSetting === DEFAULT_MCP_PORT,
    );
    context.telemetry.properties.authKind = node ? getNodeAuthKind(node) : 'none';
    context.telemetry.properties.hasNode = String(!!node);
    context.telemetry.properties.containerScoped = String(!!node?.model.container);

    if (!shellInstalled) {
        await promptToResolveMissingCosmosDBShell(context, node, launchCosmosDBShell);
        return;
    }

    if (startupLocationArgs.length > 0 && !shellVersionSupported) {
        await promptToUpdateCosmosDBShell(context, node, launchCosmosDBShell);
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
    context.valuesToMask.push(rawEndpoint);
    if (cosmosDBShellCredential) {
        context.valuesToMask.push(cosmosDBShellCredential);
    }
    if (entraCredential?.tenantId) {
        context.valuesToMask.push(entraCredential.tenantId);
    }
    if (managedIdentityCredential?.clientId) {
        context.valuesToMask.push(managedIdentityCredential.clientId);
    }
    const databaseId = node.model.database?.id;
    if (databaseId) {
        context.valuesToMask.push(databaseId);
    }
    const containerId = node.model.container?.id;
    if (containerId) {
        context.valuesToMask.push(containerId);
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

    args.push(...startupLocationArgs);

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
            context.valuesToMask.push(fallbackToken);
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
}
