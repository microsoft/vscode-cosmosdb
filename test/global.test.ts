/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TestOutputChannel, TestUserInput } from 'vscode-azureextensiondev';
import { ext, registerOnActionStartHandler } from '../extension.bundle';

export const longRunningTestsEnabled: boolean = !/^(false|0)?$/i.test(process.env.ENABLE_LONG_RUNNING_TESTS || '');

// Runs before all tests
suiteSetup(async function (this: Mocha.Context): Promise<void> {
    this.timeout(2 * 60 * 1000);
    await vscode.commands.executeCommand('azureDatabases.refresh'); // activate the extension before tests begin
    ext.outputChannel = new TestOutputChannel();

    registerOnActionStartHandler(context => {
        // Use `TestUserInput` by default so we get an error if an unexpected call to `context.ui` occurs, rather than timing out
        context.ui = new TestUserInput(vscode);
    });
});
