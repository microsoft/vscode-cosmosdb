/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { testUserInput } from '../global.test';

export async function getConnectionString(accountName: string): Promise<string> {
    await vscode.env.clipboard.writeText('');
    await testUserInput.runWithInputs([new RegExp(accountName)], async () => {
        await vscode.commands.executeCommand('azureDatabases.copyConnectionString');
    });
    return await vscode.env.clipboard.readText();
}
