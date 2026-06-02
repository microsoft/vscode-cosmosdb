/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VS Code MCP server provider for the Cosmos DB Shell. Publishes a single
 * {@link vscode.McpHttpServerDefinition} when the shell binary is installed and the
 * `cosmosDB.shell.MCP.enabled` setting is on, and lazily launches the shell with `--mcp`
 * when VS Code or Copilot asks to resolve the server.
 */
import * as l10n from '@vscode/l10n';
import * as http from 'http';
import * as net from 'net';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';
import {
    COMMAND_LAUNCH_COSMOS_DB_SHELL,
    COSMOS_DB_SHELL_TERMINAL_NAME,
    DEFAULT_MCP_PORT,
    MCP_SERVER_NAME,
    SETTING_MCP_ENABLED,
    SETTING_MCP_PORT,
    SETTING_SHELL_PATH,
} from './constants';
import { CosmosDBShellMcpHost, getCosmosDBShellMcpEndpoint } from './cosmosDBShellMcpEndpoint';
import { invalidateCosmosDBShellSupportCache, isCosmosDBShellInstalled } from './shellSupportCache';

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
        socket.connect(parseInt(port, 10), CosmosDBShellMcpHost);
    });
}

function isMcpShellServer(port: string): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`${getCosmosDBShellMcpEndpoint(port)}/sse`, { timeout: 3000 }, (res) => {
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
    if (server.label !== MCP_SERVER_NAME) {
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
            SETTING_MCP_PORT,
        );
        throw new Error(
            `Port ${mcpPort} is in use by another process that is not the Cosmos DB Shell MCP server. Configure a different port via the "${SETTING_MCP_PORT}" setting.`,
        );
    }

    // No user-facing notifications here: resolve can be invoked by Copilot/VS Code during
    // background tool discovery and we don't want to nag users who never asked for Cosmos DB MCP.
    // The provider normally hides the server when prerequisites aren't met (see
    // provideMcpServerDefinitions); these throws are a safety net for cached definitions.
    if (!isCosmosDBShellInstalled()) {
        ext.outputChannel.appendLine('MCP resolve: Cosmos DB Shell binary is not installed or not found; skipping.');
        throw new Error(
            `Cosmos DB Shell binary is not installed or not found. The user must install it or configure the "${SETTING_SHELL_PATH}" setting.`,
        );
    }

    const mcpEnabled = SettingsService.getSetting<boolean>(SETTING_MCP_ENABLED) ?? false;

    if (!mcpEnabled) {
        ext.outputChannel.appendLine(`MCP resolve: "${SETTING_MCP_ENABLED}" is disabled; skipping.`);
        throw new Error(
            `Cosmos DB Shell MCP is not enabled. The user must enable the "${SETTING_MCP_ENABLED}" setting and restart the MCP server.`,
        );
    }

    const existingTerminal = vscode.window.terminals.find(
        (t) => t.creationOptions.name === COSMOS_DB_SHELL_TERMINAL_NAME,
    );

    if (existingTerminal) {
        void vscode.window.showWarningMessage(
            l10n.t('The running Cosmos DB Shell was started without MCP. Please close it and try again.'),
        );
        throw new Error(
            'A Cosmos DB Shell terminal is already running without MCP support. The user must close it and try again.',
        );
    }

    ext.outputChannel.appendLine('MCP resolve: launching Cosmos DB Shell with --mcp');
    await vscode.commands.executeCommand(COMMAND_LAUNCH_COSMOS_DB_SHELL);

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
            (SettingsService.getSetting<number>(SETTING_MCP_PORT) ?? DEFAULT_MCP_PORT).toString();

        context.subscriptions.push(
            vscode.lm.registerMcpServerDefinitionProvider('cosmosDbShellMcpProvider', {
                onDidChangeMcpServerDefinitions: didChangeEmitter.event,
                provideMcpServerDefinitions: () => {
                    // Only publish the MCP server when it can actually be used. Otherwise Copilot
                    // (or any MCP consumer) would call resolveMcpServerDefinition during background
                    // tool discovery and trigger user-facing prompts even though the user never
                    // asked for Cosmos DB MCP. The didChangeEmitter below re-fires this when the
                    // relevant settings or shell path change.
                    const mcpEnabled = SettingsService.getSetting<boolean>(SETTING_MCP_ENABLED) ?? false;
                    if (!mcpEnabled || !isCosmosDBShellInstalled()) {
                        return [];
                    }
                    const mcpPort = getMcpPort();
                    return [
                        new vscode.McpHttpServerDefinition(
                            MCP_SERVER_NAME,
                            vscode.Uri.parse(getCosmosDBShellMcpEndpoint(mcpPort)),
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
                if (event.affectsConfiguration(SETTING_SHELL_PATH)) {
                    invalidateCosmosDBShellSupportCache();
                }
                if (
                    event.affectsConfiguration(SETTING_MCP_PORT) ||
                    event.affectsConfiguration(SETTING_MCP_ENABLED) ||
                    event.affectsConfiguration(SETTING_SHELL_PATH)
                ) {
                    didChangeEmitter.fire();
                }
            }),
        );

        context.subscriptions.push(didChangeEmitter);
    } catch (err) {
        ext.outputChannel.appendLine('error while registering MCP server: ' + String(err));
    }
}
