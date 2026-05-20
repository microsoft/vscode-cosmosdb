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

    let target: vscode.WorkspaceFolder | undefined;
    if (workspaceFolders.length === 1) {
        target = workspaceFolders[0];
    } else {
        target = await vscode.window.showWorkspaceFolderPick({
            placeHolder: l10n.t('Select a workspace folder for the migration project'),
        });
        if (!target) return;
    }

    MigrationAssistantTab.render(target.uri.fsPath);
}
