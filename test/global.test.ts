/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAzureUserInput, registerOnActionStartHandler } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../src/extensionVariables';
import { TestOutputChannel } from './TestOutputChannel';
import { TestUserInput } from './TestUserInput';

// Runs before all tests
suiteSetup(async function (this: Mocha.Context): Promise<void> {
    this.timeout(2 * 60 * 1000);

    // Get the extension and activate it
    const extension = vscode.extensions.getExtension('ms-azuretools.vscode-cosmosdb');
    if (!extension) {
        throw new Error('Extension not found');
    }

    if (!extension.isActive) {
        await extension.activate();
    }

    // Override output channel with test version
    ext.outputChannel = new TestOutputChannel();

    registerOnActionStartHandler((context) => {
        // Use `TestUserInput` by default so we get an error if an unexpected call to `context.ui` occurs, rather than timing out
        context.ui = new TestUserInput(vscode) as IAzureUserInput;
    });
});
