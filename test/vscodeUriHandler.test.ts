/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { ext, globalUriHandler, registerOnActionStartHandler } from '../extension.bundle';
import { runWithInputs } from './TestUserInput';

suite('vscodeUriHandler - Open in VS Code', () => {
    let originalExecuteCommand: typeof vscode.commands.executeCommand;
    let originalRgApiV2: typeof ext.rgApiV2;
    let originalCosmosDBBranchDataProvider: typeof ext.cosmosDBBranchDataProvider;

    beforeEach(() => {
        originalExecuteCommand = vscode.commands.executeCommand;
        originalRgApiV2 = ext.rgApiV2;
        originalCosmosDBBranchDataProvider = ext.cosmosDBBranchDataProvider;
    });

    afterEach(() => {
        (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            originalExecuteCommand;
        ext.rgApiV2 = originalRgApiV2;
        ext.cosmosDBBranchDataProvider = originalCosmosDBBranchDataProvider;
    });

    test('prompts to sign in when subscription is not found and retries reveal', async () => {
        let revealCallCount = 0;
        let loginCalled = false;

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
    });

    test('treats dismissing the prompt as cancellation (no wrapped error)', async () => {
        (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async () => undefined) as typeof vscode.commands.executeCommand;

        // Stub reveal to throw "Subscription not found" so the warning dialog is shown
        ext.rgApiV2 = {
            resources: {
                revealAzureResource: async () => {
                    throw new Error('Subscription not found');
                },
                getSelectedAzureNode: async () => undefined,
            },
        } as unknown as typeof ext.rgApiV2;

        ext.cosmosDBBranchDataProvider = {
            findNodeById: async () => undefined,
        } as unknown as typeof ext.cosmosDBBranchDataProvider;

        const resourceId =
            '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/myacct';
        const uri = vscode.Uri.parse(
            `vscode://ms-azuretools.vscode-cosmosdb/?resourceId=${encodeURIComponent(resourceId)}`,
        );

        // Simulate user dismissing the warning dialog by stubbing showWarningMessage to return undefined.
        // This exercises the `!choice` branch in revealAzureResourceWithAccountPrompt which throws
        // UserCancelledError, which globalUriHandler must handle silently (no wrapped error notification).
        const disposable = registerOnActionStartHandler((context) => {
            if (context.callbackId === 'handleExternalUri') {
                (context.ui as any).showWarningMessage = async () => undefined as unknown as vscode.MessageItem;
            }
        });

        // globalUriHandler should resolve without throwing a wrapped error
        try {
            await globalUriHandler(uri);
        } finally {
            disposable.dispose();
        }
    });

    test('prompts to sign in when resource is not found after reveal (account mismatch) and retries', async () => {
        let loginCalled = false;
        let revealCallCount = 0;
        let findCallCount = 0;

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
    });
});
