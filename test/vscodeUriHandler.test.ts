/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { ext, globalUriHandler, registerOnActionStartHandler, UserCancelledError } from '../extension.bundle';
import { runWithInputs } from './TestUserInput';

suite('vscodeUriHandler - Open in VS Code', () => {
    test('prompts to sign in when subscription is not found and retries reveal', async () => {
        const originalExecuteCommand = vscode.commands.executeCommand;

        let revealCallCount = 0;
        let loginCalled = false;

        try {
            (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
                (async (command: string) => {
                    if (command === 'azure-account.login') {
                        loginCalled = true;
                    }
                    return undefined;
                }) as typeof vscode.commands.executeCommand;

            // Stub Azure Resources API + branch provider
            ext.rgApiV2 = {
                resources: {
                    revealAzureResource: async () => {
                        revealCallCount++;
                        if (revealCallCount === 1) {
                            throw new Error('Subscription not found');
                        }
                    },
                    getSelectedAzureNode: async () => undefined,
                },
            } as unknown as typeof ext.rgApiV2;

            ext.cosmosDBBranchDataProvider = {
                findNodeById: async (id: string) => ({ id }) as unknown,
            } as unknown as typeof ext.cosmosDBBranchDataProvider;

            const resourceId =
                '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/myacct';

            const uri = vscode.Uri.parse(
                `vscode://ms-azuretools.vscode-cosmosdb/?resourceId=${encodeURIComponent(resourceId)}`,
            );

            await runWithInputs('handleExternalUri', ['Sign in'], registerOnActionStartHandler, async () => {
                await globalUriHandler(uri);
            });

            assert.equal(loginCalled, true);
            assert.equal(revealCallCount, 2);
        } finally {
            (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
                originalExecuteCommand;
        }
    });

    test('treats dismissing the prompt as cancellation (no wrapped error)', async () => {
        const originalExecuteCommand = vscode.commands.executeCommand;

        try {
            (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
                (async () => undefined) as typeof vscode.commands.executeCommand;

            ext.rgApiV2 = {
                resources: {
                    revealAzureResource: async () => {
                        throw new Error('Subscription not found');
                    },
                    getSelectedAzureNode: async () => undefined,
                },
            } as unknown as typeof ext.rgApiV2;

            ext.cosmosDBBranchDataProvider = {
                findNodeById: async (id: string) => ({ id }) as unknown,
            } as unknown as typeof ext.cosmosDBBranchDataProvider;

            const resourceId =
                '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/myacct';
            const uri = vscode.Uri.parse(
                `vscode://ms-azuretools.vscode-cosmosdb/?resourceId=${encodeURIComponent(resourceId)}`,
            );

            // Simulate the user dismissing the prompt by having `context.ui.showWarningMessage` cancel.
            // The test input infrastructure can't return "undefined" from `showWarningMessage`,
            // so we simulate cancel by throwing `UserCancelledError`.
            ext.rgApiV2 = {
                resources: {
                    revealAzureResource: async () => {
                        throw new UserCancelledError('subscriptionNotFound');
                    },
                    getSelectedAzureNode: async () => undefined,
                },
            } as unknown as typeof ext.rgApiV2;

            await globalUriHandler(uri);
        } finally {
            (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
                originalExecuteCommand;
        }
    });

    test('prompts to sign in when resource is not found after reveal (account mismatch) and retries', async () => {
        const originalExecuteCommand = vscode.commands.executeCommand;

        let loginCalled = false;
        let revealCallCount = 0;
        let findCallCount = 0;

        try {
            (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
                (async (command: string) => {
                    if (command === 'azure-account.login') {
                        loginCalled = true;
                    }
                    return undefined;
                }) as typeof vscode.commands.executeCommand;

            ext.rgApiV2 = {
                resources: {
                    revealAzureResource: async () => {
                        revealCallCount++;
                    },
                    getSelectedAzureNode: async () => undefined,
                },
            } as unknown as typeof ext.rgApiV2;

            ext.cosmosDBBranchDataProvider = {
                findNodeById: async () => {
                    findCallCount++;
                    // First lookup fails (simulating wrong account/subscription), second succeeds after sign-in.
                    return findCallCount === 1 ? undefined : ({ id: 'found' } as unknown);
                },
            } as unknown as typeof ext.cosmosDBBranchDataProvider;

            const resourceId =
                '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/myacct';

            const uri = vscode.Uri.parse(
                `vscode://ms-azuretools.vscode-cosmosdb/?resourceId=${encodeURIComponent(resourceId)}`,
            );

            await runWithInputs('handleExternalUri', ['Sign in'], registerOnActionStartHandler, async () => {
                await globalUriHandler(uri);
            });

            assert.equal(loginCalled, true);
            // reveal happens at least once, and then again after the prompt.
            assert.ok(revealCallCount >= 2);
        } finally {
            (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
                originalExecuteCommand;
        }
    });
});
