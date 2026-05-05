/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * entry-point for mongoClusters-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to mongoClusters-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import { type ContainerDefinition, type DatabaseDefinition } from '@azure/cosmos';
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
import { type CosmosDBEntraIdCredential, type CosmosDBManagedIdentityCredential } from '../cosmosdb/CosmosDBCredential';
import { getAccessTokenForVSCode } from '../cosmosdb/utils/azureSessionHelper';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';
import { resolveCosmosDBShellCommand } from './cosmosDBShellCommandResolver';
import { CosmosDBShellMcpHost, getCosmosDBShellMcpEndpoint } from './cosmosDBShellMcpEndpoint';

type AuthKind = 'emulator' | 'accountKey' | 'entraId' | 'managedIdentity' | 'none';

type ShellTerminalState = {
    /** Endpoint the shell process was launched against, or '' for command-palette launches without a node. */
    endpoint: string;
    /** Authentication mode used at launch. Determines which env vars (if any) are baked into the process. */
    authKind: AuthKind;
    tenantId?: string;
    managedIdentityClientId?: string;
};

// Track per-terminal launch state so we know which Cosmos DB Shell terminals can be reused
// for a given node. The state describes how the process was *launched* (endpoint + auth
// mode + env vars baked in), not its current in-shell connection status: a user may have
// run `disconnect` inside the shell, which VS Code cannot observe. The reuse path therefore
// always re-issues `connect` before sending further commands.
const terminalStates = new Map<vscode.Terminal, ShellTerminalState>();

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
                const isCosmosDBShellInstalled: boolean = isCosmosDBShellSupportEnabled();
                vscode.commands.executeCommand(
                    'setContext',
                    'vscodeDatabases.cosmosDBShellSupportEnabled',
                    isCosmosDBShellInstalled,
                );

                // Initialize terminal context on activation
                this.updateCosmosDBShellTerminalContext();

                // Watch for terminal open events
                const openListener = vscode.window.onDidOpenTerminal((terminal) => {
                    // Check if it's a Cosmos DB Shell terminal
                    if (terminal.name === 'Cosmos DB Shell') {
                        this.updateCosmosDBShellTerminalContext();
                    }
                });

                // Watch for terminal close events
                const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
                    // Check if it was a Cosmos DB Shell terminal
                    if (terminal.name === 'Cosmos DB Shell') {
                        this.updateCosmosDBShellTerminalContext();
                        // Remove tracked launch state for this terminal
                        terminalStates.delete(terminal);
                    }
                });

                // Store listeners for disposal
                this.terminalChangeListeners.push(openListener, closeListener);

                registerCommandWithTreeNodeUnwrapping('cosmosDB.launchCosmosDBShell', connectCosmosDBShell);

                if (isCosmosDBShellInstalled) {
                    ext.outputChannel.appendLine(`Cosmos DB Shell Extension: activated.`);
                } else {
                    ext.outputChannel.appendLine(`Cosmos DB Shell Extension: deactivated.`);
                }
            },
        );
    }

    private updateCosmosDBShellTerminalContext(): void {
        const hasCosmosDBShellTerminal = vscode.window.terminals.some(
            (terminal) => terminal.name === 'Cosmos DB Shell',
        );
        vscode.commands.executeCommand(
            'setContext',
            'vscodeDatabases.cosmosDBShellTerminalOpen',
            hasCosmosDBShellTerminal,
        );
        ext.outputChannel.appendLine(
            `Cosmos DB Shell terminal context updated: ${hasCosmosDBShellTerminal ? 'open' : 'closed'}`,
        );
    }
}

// Create a singleton instance to access the context updater
//const cosmosDBShellExt = new CosmosDBShellExtension();

function getCosmosDBShellCommand(): string {
    const shellPath: string | undefined = SettingsService.getSetting<string>('cosmosDB.shell.path');
    return resolveCosmosDBShellCommand(shellPath);
}

function isCosmosDBShellPathFound(): boolean {
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

function isDotNetSdkInstalled(dotnetPath?: string): boolean {
    try {
        const output = child.execFileSync(dotnetPath ?? 'dotnet', ['--list-sdks'], {
            windowsHide: true,
            stdio: 'pipe',
        });
        return output.toString('utf8').trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * Runs `dotnet tool install --global CosmosDBShell --prerelease` with a progress
 * notification, streaming output to the extension output channel. Returns true
 * when the process exits with code 0.
 */
async function installCosmosDBShellWithDotNetTool(dotnetPath?: string): Promise<boolean> {
    return await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Installing Cosmos DB Shell…'),
            cancellable: true,
        },
        async (_progress, token) => {
            ext.outputChannel.show(true);
            const dotnetExe = dotnetPath ?? 'dotnet';
            ext.outputChannel.appendLine(`> ${dotnetExe} tool install --global CosmosDBShell --prerelease`);

            return await new Promise<boolean>((resolve) => {
                const proc = child.spawn(dotnetExe, ['tool', 'install', '--global', 'CosmosDBShell', '--prerelease'], {
                    windowsHide: true,
                    shell: false,
                });

                token.onCancellationRequested(() => {
                    proc.kill();
                });

                proc.stdout?.on('data', (data: Buffer) => {
                    ext.outputChannel.append(data.toString('utf8'));
                });
                proc.stderr?.on('data', (data: Buffer) => {
                    ext.outputChannel.append(data.toString('utf8'));
                });
                proc.on('error', (err) => {
                    ext.outputChannel.appendLine(`Failed to start dotnet: ${err.message}`);
                    resolve(false);
                });
                proc.on('close', (code) => {
                    ext.outputChannel.appendLine(`\nProcess exited with code ${code}.`);
                    resolve(code === 0);
                });
            });
        },
    );
}

/**
 * Prompts the user to install Cosmos DB Shell via `dotnet tool install`, and on
 * success automatically continues the original launch flow.
 */
async function promptToInstallCosmosDBShell(
    context: IActionContext,
    node: NoSqlContainerResourceItem | undefined,
): Promise<void> {
    const install = l10n.t('Install');
    const settings = l10n.t('Settings');
    const selection = await vscode.window.showInformationMessage(
        l10n.t(
            'Cosmos DB Shell is not installed. Install it now using `dotnet tool install --global CosmosDBShell --prerelease`?',
        ),
        { modal: true },
        install,
        settings,
    );

    if (selection === settings) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'cosmosDB.shell.path');
        return;
    }
    if (selection !== install) {
        return;
    }

    await installAndLaunchCosmosDBShell(context, node);
}

/**
 * Runs the `dotnet tool install` for Cosmos DB Shell, then either reloads the window
 * (if PATH hasn't picked up the new tool yet) or auto-launches the shell to continue
 * the user's original action. Used both by the explicit install prompt and by the
 * auto-chain after a fresh .NET SDK acquisition.
 */
async function installAndLaunchCosmosDBShell(
    context: IActionContext,
    node: NoSqlContainerResourceItem | undefined,
    dotnetPath?: string,
): Promise<void> {
    const success = await installCosmosDBShellWithDotNetTool(dotnetPath);
    if (!success) {
        const showOutput = l10n.t('Show Output');
        const failureSelection = await vscode.window.showErrorMessage(
            l10n.t('Failed to install Cosmos DB Shell. See the output for details.'),
            showOutput,
        );
        if (failureSelection === showOutput) {
            ext.outputChannel.show(true);
        }
        return;
    }

    // On a brand-new install the user's PATH may not yet include `~/.dotnet/tools`
    // in the current VS Code session. If we still can't resolve the shell, ask to reload.
    if (!isCosmosDBShellSupportEnabled()) {
        const reload = l10n.t('Reload Window');
        const reloadSelection = await vscode.window.showInformationMessage(
            l10n.t(
                'Cosmos DB Shell was installed, but its location is not yet on PATH for this VS Code window. Reload the window to pick it up.',
            ),
            reload,
        );
        if (reloadSelection === reload) {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        return;
    }

    // Auto-relaunch with the original node so the user lands where they intended.
    await launchCosmosDBShell(context, node);
}

/**
 * Awaits the `.NET Install Tool` SDK acquisition command. Returns the resolved
 * `dotnet` executable path on success, or undefined when the acquisition failed
 * or did not return a path.
 */
async function tryInstallDotNetSdkViaExtension(): Promise<string | undefined> {
    try {
        const result = await vscode.commands.executeCommand<{ dotnetPath?: string } | undefined>(
            'dotnet.acquireGlobalSDKPublic',
        );
        return result?.dotnetPath;
    } catch (err) {
        ext.outputChannel.appendLine(`dotnet.acquireGlobalSDKPublic failed: ${String(err)}`);
        return undefined;
    }
}

async function promptToInstallDotNetSdk(
    context: IActionContext,
    node: NoSqlContainerResourceItem | undefined,
): Promise<void> {
    const installDotNetSdk = l10n.t('Install .NET SDK');
    const installDotNetTool = l10n.t('Install .NET Install Tool');
    const downloadDotNet = l10n.t('Download .NET SDK');
    const settings = l10n.t('Settings');
    const dotNetInstallToolExtensionId = 'ms-dotnettools.vscode-dotnet-runtime';
    const isDotNetInstallToolInstalled = !!vscode.extensions.getExtension(dotNetInstallToolExtensionId);
    const primaryAction = isDotNetInstallToolInstalled ? installDotNetSdk : installDotNetTool;
    const selection = await vscode.window.showInformationMessage(
        l10n.t(
            'The .NET SDK is required to install Cosmos DB Shell. Install the .NET SDK, download it manually, or configure an existing Cosmos DB Shell path in settings.',
        ),
        { modal: true },
        primaryAction,
        downloadDotNet,
        settings,
    );

    if (selection === installDotNetSdk) {
        const dotnetPath = await tryInstallDotNetSdkViaExtension();
        if (dotnetPath && isDotNetSdkInstalled(dotnetPath)) {
            // Chain forward: now that the SDK is available, automatically continue with the
            // Cosmos DB Shell install using the freshly-acquired dotnet path so we don't have
            // to wait for PATH to be picked up by this VS Code session.
            await installAndLaunchCosmosDBShell(context, node, dotnetPath);
        } else if (isDotNetSdkInstalled()) {
            await promptToInstallCosmosDBShell(context, node);
        }
    } else if (selection === installDotNetTool) {
        void vscode.commands.executeCommand('workbench.extensions.installExtension', dotNetInstallToolExtensionId);
    } else if (selection === downloadDotNet) {
        void vscode.env.openExternal(vscode.Uri.parse('https://dot.net/download'));
    } else if (selection === settings) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'cosmosDB.shell.path');
    }
}

async function promptToResolveMissingCosmosDBShell(
    context: IActionContext,
    node: NoSqlContainerResourceItem | undefined,
): Promise<void> {
    if (isCosmosDBShellPathFound()) {
        const settings = l10n.t('Settings');
        const selection = await vscode.window.showErrorMessage(
            l10n.t(
                'Cosmos DB Shell path is configured but the executable could not be run. Please verify the path in settings.',
            ),
            settings,
        );
        if (selection === settings) {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'cosmosDB.shell.path');
        }
        return;
    }

    if (isDotNetSdkInstalled()) {
        await promptToInstallCosmosDBShell(context, node);
    } else {
        await promptToInstallDotNetSdk(context, node);
    }
}

export async function launchCosmosDBShell(context: IActionContext, node?: NoSqlContainerResourceItem) {
    const isCosmosDBShellInstalled: boolean = isCosmosDBShellSupportEnabled();

    if (!isCosmosDBShellInstalled) {
        await promptToResolveMissingCosmosDBShell(context, node);
        return;
    }

    const command = getCosmosDBShellCommand();
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
        if (fallbackToken) {
            env['COSMOSDB_SHELL_TOKEN'] = fallbackToken;
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

export async function connectCosmosDBShell(_context: IActionContext, node?: NoSqlContainerResourceItem) {
    if (!node) {
        // No node selected, just launch a new shell without connection.
        await launchCosmosDBShell(_context, node);
        return;
    }

    const rawConnectionString = node.model.accountInfo.endpoint;
    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    // Try to reuse an existing Cosmos DB Shell terminal whose launch-time env credentials
    // are compatible with what this node needs. If none qualifies, fall through to launch a
    // fresh shell so the right env vars can be baked into the new process.
    const reusable = findReusableTerminalForNode(node);
    if (reusable) {
        const { terminal } = reusable;
        terminal.show();
        // Always re-issue `connect` before navigating: the shell may have been disconnected
        // by the user, or previously associated with a different account on a prior reuse.
        terminal.sendText(buildInteractiveConnectCommand(node, rawConnectionString), true);
        const containerCommand = getGoToContainerCommand(node.model.database, node.model.container);
        if (containerCommand) {
            terminal.sendText(containerCommand, true);
        }
        // Update tracked state to reflect the now-active node.
        terminalStates.set(terminal, buildTerminalStateForNode(node));
        return;
    }

    // No reusable terminal (none open, or a different launch-time env is required).
    await launchCosmosDBShell(_context, node);
}

/**
 * Classifies the authentication mode required by a node. This determines which env vars
 * (if any) the shell process must have been launched with in order to authenticate.
 */
function getNodeAuthKind(node: NoSqlContainerResourceItem): AuthKind {
    if (node.model.accountInfo.isEmulator) {
        return 'emulator';
    }
    if (getCosmosDBShellCredential(node)) {
        return 'accountKey';
    }
    if (getEntraIdCredential(node)) {
        return 'entraId';
    }
    if (getManagedIdentityCredential(node)) {
        return 'managedIdentity';
    }
    return 'none';
}

/** Builds a {@link ShellTerminalState} record describing how a shell would be launched for this node. */
function buildTerminalStateForNode(node: NoSqlContainerResourceItem): ShellTerminalState {
    return {
        endpoint: node.model.accountInfo.endpoint ?? '',
        authKind: getNodeAuthKind(node),
        tenantId: getEntraIdCredential(node)?.tenantId,
        managedIdentityClientId: getManagedIdentityCredential(node)?.clientId,
    };
}

/**
 * Determines whether an already-running Cosmos DB Shell terminal can host the given node.
 *
 * Auth modes that need launch-time env vars (account key, Entra ID fallback token) are only
 * compatible if the terminal was launched for the *same endpoint* with the *same* auth mode
 * (and tenant for Entra ID) — otherwise the baked-in env would be wrong for the new node.
 * Auth modes that don't rely on env vars (emulator, managed identity, none) can run in any
 * tracked terminal via the interactive `connect` command.
 */
function canReuseTerminalForNode(state: ShellTerminalState, node: NoSqlContainerResourceItem): boolean {
    const nodeAuth = getNodeAuthKind(node);

    if (nodeAuth === 'emulator' || nodeAuth === 'managedIdentity' || nodeAuth === 'none') {
        return true;
    }

    if (state.endpoint !== node.model.accountInfo.endpoint || state.authKind !== nodeAuth) {
        return false;
    }

    if (nodeAuth === 'entraId') {
        const cred = getEntraIdCredential(node);
        if (cred?.tenantId !== state.tenantId) {
            return false;
        }
    }

    return true;
}

/**
 * Finds the best tracked Cosmos DB Shell terminal to reuse for the given node, preferring
 * terminals already associated with the same endpoint to keep terminal usage stable.
 */
function findReusableTerminalForNode(
    node: NoSqlContainerResourceItem,
): { terminal: vscode.Terminal; state: ShellTerminalState } | undefined {
    const candidates: Array<{ terminal: vscode.Terminal; state: ShellTerminalState; sameEndpoint: boolean }> = [];
    for (const [terminal, state] of terminalStates) {
        if (!vscode.window.terminals.includes(terminal)) {
            continue;
        }
        if (!canReuseTerminalForNode(state, node)) {
            continue;
        }
        candidates.push({
            terminal,
            state,
            sameEndpoint: state.endpoint === node.model.accountInfo.endpoint,
        });
    }
    candidates.sort((a, b) => Number(b.sameEndpoint) - Number(a.sameEndpoint));
    return candidates[0];
}

/**
 * Builds the interactive `connect` command that mirrors the CLI `--connect` flag and related
 * credential flags, so an already-running Cosmos DB Shell can be attached to a specific account.
 */
function buildInteractiveConnectCommand(node: NoSqlContainerResourceItem, endpoint: string): string {
    const parts = ['connect', quoteArg(endpoint)];

    if (!node.model.accountInfo.isEmulator) {
        const entraCredential = getEntraIdCredential(node);
        if (entraCredential) {
            parts.push('--vscode-credential');
            if (entraCredential.tenantId) {
                parts.push('--tenant', quoteArg(entraCredential.tenantId));
            }
        }

        const managedIdentityCredential = getManagedIdentityCredential(node);
        if (managedIdentityCredential?.clientId) {
            parts.push('--managed-identity', quoteArg(managedIdentityCredential.clientId));
        }
    }

    return parts.join(' ');
}

function quoteArg(value: string): string {
    return /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function getCosmosDBShellCredential(node: NoSqlContainerResourceItem): string | undefined {
    const credential = node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.accountKey);
    return credential?.key;
}

function getEntraIdCredential(node: NoSqlContainerResourceItem): CosmosDBEntraIdCredential | undefined {
    return node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.entraId);
}

function getManagedIdentityCredential(node: NoSqlContainerResourceItem): CosmosDBManagedIdentityCredential | undefined {
    return node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.managedIdentity);
}

/**
 * Obtains an access token from VS Code's authentication session for the Cosmos DB endpoint.
 * Used as a fallback token via COSMOSDB_SHELL_TOKEN if VisualStudioCodeCredential fails in the shell.
 */
async function getCosmosDBShellToken(
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
 * Determines if CosmosDBShell is installed.
 *
 * @returns true, if CosmosDBShell is installed, false otherwise.
 */
export function isCosmosDBShellSupportEnabled(): boolean {
    const command = getCosmosDBShellCommand();
    const cached = cosmosDBShellSupportCache.get(command);
    if (cached !== undefined) {
        return cached;
    }
    const result = detectCosmosDBShellSupport(command);
    cosmosDBShellSupportCache.set(command, result);
    return result;
}

/**
 * Clears the cached result of {@link isCosmosDBShellSupportEnabled}.
 * Call this when the shell path configuration changes or the binary may have been installed/removed.
 */
export function invalidateCosmosDBShellSupportCache(): void {
    cosmosDBShellSupportCache.clear();
}

const cosmosDBShellSupportCache = new Map<string, boolean>();

function detectCosmosDBShellSupport(command: string): boolean {
    try {
        child.execFileSync(command, ['--version'], {
            windowsHide: true,
            env: {
                ...process.env,
                // CosmosDBShell may use ANSI output libraries (e.g. Spectre.Console).
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

        // Workaround: CosmosDBShell may print a valid version string but still exit non-zero
        // when ANSI is not available. Treat that as installed.
        const combinedOutput = `${stdout}\n${stderr}`;
        if (/\bCosmos(?:DB)?Shell\b/i.test(combinedOutput)) {
            ext.outputChannel.appendLine(
                'warning: CosmosDBShell "--version" exited non-zero, but returned version output; treating as installed.',
            );
            if (stderr.trim().length > 0) {
                ext.outputChannel.appendLine(stderr.trim());
            }
            return true;
        }

        ext.outputChannel.appendLine('fail ' + String(err));
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

    if (!isCosmosDBShellSupportEnabled()) {
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
    await vscode.commands.executeCommand('cosmosDB.launchCosmosDBShell');

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
                if (event.affectsConfiguration('cosmosDB.shell.path')) {
                    invalidateCosmosDBShellSupportCache();
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
        ext.outputChannel.appendLine('error while registering MCP server: ' + String(err));
    }
}

let cosmosDBShellLanguageClient: LanguageClient | undefined;

export function registerCosmosDBShellLanguageServer(context: vscode.ExtensionContext) {
    if (cosmosDBShellLanguageClient || !isCosmosDBShellSupportEnabled()) {
        return;
    }

    // Path to your LSP server executable
    const command = getCosmosDBShellCommand();
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
