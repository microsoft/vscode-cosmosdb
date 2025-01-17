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
import * as child from 'child_process';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
// eslint-disable-next-line import/consistent-type-specifier-style
import { DocDBAccountTreeItemBase } from '../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { DocDBDatabaseTreeItem } from '../docdb/tree/DocDBDatabaseTreeItem';
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';

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
    node?: MongoAccountTreeItem | DocDBAccountTreeItemBase | DocDBCollectionTreeItem,
) {
    const command = getCosmosShellCommand();
    if (!node) {
        const terminal: vscode.Terminal = vscode.window.createTerminal('Cosmos Shell', command);
        terminal.show();
        return;
    }
    let connectionString;
    if (node instanceof MongoAccountTreeItem || node instanceof DocDBAccountTreeItemBase) {
        connectionString = node.connectionString;
    } else {
        connectionString = node.parent.connectionString;
    }
    const terminal: vscode.Terminal = vscode.window.createTerminal('Cosmos Shell', command, [
        '--connect',
        connectionString,
    ]);
    terminal.show();
    if (node instanceof DocDBCollectionTreeItem) {
        terminal.sendText('cd ' + node.parent.label + '/' + node.label, true);
    } else if (node instanceof DocDBDatabaseTreeItem) {
        terminal.sendText('cd ' + node.label, true);
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
