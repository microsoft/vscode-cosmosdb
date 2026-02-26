/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { MigrationAssistantTab } from '../../panels/MigrationAssistantTab';

export async function openMigrationAssistant(_context: IActionContext): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        void vscode.window.showErrorMessage(l10n.t('A workspace folder is required to create a migration project.'));
        return;
    }

    MigrationAssistantTab.render(workspaceFolders[0].uri.fsPath);
}
