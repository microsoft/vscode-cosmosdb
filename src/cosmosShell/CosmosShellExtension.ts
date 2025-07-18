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

export function launchCosmosShell(
    _context: IActionContext,
    node?: NoSqlContainerResourceItem
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
    // connection string discovery for these items can be slow, so we need to run it with a temporary description
    const rawConnectionString = node.model.accountInfo.endpoint

    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    const terminal: vscode.Terminal = vscode.window.createTerminal('Cosmos Shell', command, [
        '--mcp',
        '--mcp-port',
        '6128',
        '--connect',
        rawConnectionString,
    ]);

    terminal.show();
    if (node.model.container) {
        terminal.sendText('cd '+ node.model.database.id + '/' + node.model.container.id, true);
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
        return false;
    }
}
