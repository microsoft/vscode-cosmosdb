/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';
import { nonNullValue } from './nonNull';

export function getRootPath(): string | undefined {
    // if this is a multi-root workspace, return undefined
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length === 1
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : undefined;
}

export function getBatchSizeSetting(): number {
    return nonNullValue(SettingsService.getSetting<number>(ext.settingsKeys.batchSize), 'batchSize');
}
