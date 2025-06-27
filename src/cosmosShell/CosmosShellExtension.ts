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
import { ClustersClient } from '../documentdb/ClustersClient';
import { ext } from '../extensionVariables';
import { ClusterItemBase } from '../tree/documentdb/ClusterItemBase';
import { CollectionItem } from '../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../tree/documentdb/DatabaseItem';

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

            if (isCosmosShellInstalled) {
                //   registerCommand('cosmosDB.launchCosmosShell', launchCosmosShell);
                registerCommandWithTreeNodeUnwrapping('cosmosDB.launchCosmosShell', launchCosmosShell);
                ext.outputChannel.appendLine(`Cosmos Shell Extension: activated.`);
            } else {
                ext.outputChannel.appendLine(`Cosmos Shell Extension: deactivated.`);
            }
        });
    }
}

function getCosmosShellCommand(): string {
    return process.env.COSMOS_SHELL_PATH || 'CosmosShell';
}

export async function launchCosmosShell(
    _context: IActionContext,
    node?: DatabaseItem | CollectionItem | ClusterItemBase,
) {
    const command = getCosmosShellCommand();
    if (!node) {
        const terminal: vscode.Terminal = vscode.window.createTerminal('Cosmos Shell', command, [
            '--mcp',
            '--mcp-port',
            '6128',
        ]);
        terminal.show();
        return;
    }
    let rawConnectionString: string | undefined;

    // connection string discovery for these items can be slow, so we need to run it with a temporary description

    if (node instanceof ClusterItemBase) {
        // connecting at the account level
        // we need to discover the connection string
        rawConnectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
            return node.getConnectionString();
        });
    } else {
        // node is instanceof DatabaseItem or CollectionItem and we alrady have the connection string somewhere
        const client: ClustersClient = await ClustersClient.getClient(node.cluster.id);
        rawConnectionString = client.getConnectionStringWithPassword();
    }

    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    const terminal: vscode.Terminal = vscode.window.createTerminal('Cosmos Shell', command, [
        '--mcp',
        '6128',
        '--connect',
        rawConnectionString,
    ]);

    terminal.show();
    const label = node.getTreeItem().label;
    if (typeof label !== 'string') {
        return;
    }

    if (node instanceof CollectionItem) {
        terminal.sendText('cd ' + label, true);
        // terminal.sendText('cd ' + node.parent.label + '/' + label, true);
    } else {
        terminal.sendText('cd ' + label, true);
    }
    await vscode.workspace.getConfiguration().update(
        'mcp',
        {
            servers: {
                'my-mcp-server-shell': {
                    url: 'http://localhost:6128',
                },
            },
        },
        vscode.ConfigurationTarget.Global,
    );

    // Connect to the MCP server that was just configured
    try {
        ext.outputChannel.appendLine('Connecting to MCP server at http://localhost:6128...');
        await vscode.commands.executeCommand('mcp.command.startServer', 'my-mcp-server-shell');
        ext.outputChannel.appendLine('Successfully connected to MCP server.');
    } catch (error) {
        ext.outputChannel.appendLine(`Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`);
        void vscode.window.showErrorMessage(l10n.t('Failed to connect to the MCP server. Check the output for details.'));
    }

    // Start a new Copilot chat session
    await vscode.commands.executeCommand('github.copilot.chat.startSession');


    /*
    await vscode.workspace.getConfiguration().update(
        'chat.mode',
        'agent',
        vscode.ConfigurationTarget.Workspace
    );*/
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
        return false;
    }
}
