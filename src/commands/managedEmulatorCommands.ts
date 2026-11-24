/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { EmulatorSetupTab } from '../panels/EmulatorSetupTab';
import { getManagedEmulator, refreshManagedEmulatorTree } from '../services/managedEmulator/managedEmulatorExtension';
import { describeEmulatorError, EmulatorError, type EmulatorAction } from '../services/managedEmulator/model';

const actions = [
    'start',
    'stop',
    'restart',
    'logs',
    'reconnect',
    'delete',
] as const satisfies readonly EmulatorAction[];

export function registerManagedEmulatorCommands(): void {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.emulator.setup', () => EmulatorSetupTab.open());
    registerCommandWithTreeNodeUnwrapping('cosmosDB.emulator.refresh', () => refreshManagedEmulatorTree());
    for (const action of actions) {
        registerCommandWithTreeNodeUnwrapping(
            `cosmosDB.emulator.${action}`,
            async (context, node?: { managedEmulatorId?: string }) => {
                const id = node?.managedEmulatorId;
                if (id) context.valuesToMask.push(id);
                try {
                    const service = getManagedEmulator();
                    if (!id || !service) throw new EmulatorError('missing');
                    if (action === 'delete') {
                        const confirm = l10n.t('Delete emulator and data');
                        const choice = await vscode.window.showWarningMessage(
                            l10n.t('Permanently delete the managed emulator and all its local data?'),
                            { modal: true },
                            confirm,
                        );
                        if (choice !== confirm) return;
                    }
                    const output = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: l10n.t('Working on the local Cosmos DB emulator…'),
                            cancellable: action === 'start' || action === 'restart' || action === 'reconnect',
                        },
                        async (_progress, token) => {
                            const operation = new AbortController();
                            const subscription = token.onCancellationRequested(() => operation.abort());
                            if (token.isCancellationRequested) operation.abort();
                            try {
                                return await service.act(id, action, operation.signal);
                            } finally {
                                subscription.dispose();
                            }
                        },
                    );
                    if (action === 'logs') {
                        ext.outputChannel.appendLine(output || l10n.t('No emulator logs are available.'));
                        ext.outputChannel.show();
                    }
                } catch (error) {
                    await vscode.window.showErrorMessage(describeEmulatorError(error));
                } finally {
                    refreshManagedEmulatorTree();
                }
            },
        );
    }
}
