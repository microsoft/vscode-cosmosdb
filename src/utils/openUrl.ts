/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

<<<<<<< HEAD
import * as vscode from 'vscode';

export async function openUrl(url: string): Promise<void> {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url));
=======
import * as open from 'open';

export async function openUrl(url: string): Promise<void> {
    // Using this functionality is blocked by https://github.com/Microsoft/vscode/issues/85930
    // await vscode.env.openExternal(vscode.Uri.parse(url));

    await open(url);
>>>>>>> main
}
