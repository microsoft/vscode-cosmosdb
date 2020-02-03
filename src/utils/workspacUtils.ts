/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// tslint:disable-next-line: export-name
export function getRootPath(): string | undefined {
    // if this is a multi-root workspace, return undefined
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length === 1 ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
}
