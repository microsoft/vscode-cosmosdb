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
import {
    callWithTelemetryAndErrorHandling,
    registerCommandWithTreeNodeUnwrapping,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as child from 'child_process';
import * as vscode from 'vscode';
import {
    AuthenticationMethod,
    type CosmosDBEntraIdCredential,
    type CosmosDBKeyCredential,
    type CosmosDBManagedIdentityCredential,
} from '../cosmosdb/getCosmosClient';
import { ext } from '../extensionVariables';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';

export class CosmosShellExtension implements vscode.Disposable {
    dispose(): Promise<void> {
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
            registerCommandWithTreeNodeUnwrapping('cosmosDB.launchCosmosShell', launchCosmosShell);
            if (isCosmosShellInstalled) {
                ext.outputChannel.appendLine(`Cosmos Shell Extension: activated.`);
            } else {
                ext.outputChannel.appendLine(`Cosmos Shell Extension: deactivated.`);
            }
        });
    }
}

function getCosmosShellCommand(): string {
    const config = vscode.workspace.getConfiguration();
    const shellPath: string | undefined = config.get('cosmosDB.shell.path');
    return shellPath || 'CosmosShell';
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
        return;
    }

    let cosmosShellCredential: string | undefined;

    for (const credential of node.model.accountInfo.credentials) {
        switch (credential.type) {
            case AuthenticationMethod.accountKey: {
                const keyId = credential as CosmosDBKeyCredential;
                cosmosShellCredential = `key=${keyId.key}`;
                break;
            }
            case AuthenticationMethod.entraId: {
                const tenantId = credential as CosmosDBEntraIdCredential;
                cosmosShellCredential = `tenantId=${tenantId.tenantId}`;
                break;
            }
            case AuthenticationMethod.managedIdentity: {
                const clientId = credential as CosmosDBManagedIdentityCredential;
                cosmosShellCredential = `identity=${clientId.type}`;
                break;
            }
            default:
                continue;
        }
        if (cosmosShellCredential) {
            break;
        }
    }

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
    if (node.model.container) {
        terminal.sendText('cd ' + node.model.database.id + '/' + node.model.container.id, true);
    } else if (node.model.database) {
        terminal.sendText('cd ' + node.model.database.id, true);
    }
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
const McpServerName = 'localCosmosShellServer';

export function registerMcpServer(context: vscode.ExtensionContext): void {
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
