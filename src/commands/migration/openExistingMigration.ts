/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { MigrationAssistantTab } from '../../panels/MigrationAssistantTab';
import { MIGRATION_FOLDER } from '../../services/MigrationProjectService';
import { type MigrationItem } from '../../tree/workspace-view/migration/MigrationItem';

function isInCurrentWorkspace(workspacePath: string): boolean {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const target =
        process.platform === 'win32' ? path.resolve(workspacePath).toLowerCase() : path.resolve(workspacePath);
    return folders.some((f) => {
        const folder =
            process.platform === 'win32' ? path.resolve(f.uri.fsPath).toLowerCase() : path.resolve(f.uri.fsPath);
        return folder === target;
    });
}

/**
 * If the migration project's folder isn't part of the current workspace, prompt
 * the user to open it. Returns true if the caller should proceed to open the
 * assistant tab in the current window, false if the workspace is being switched
 * or the user cancelled.
 */
async function ensureWorkspaceOrPrompt(workspacePath: string): Promise<boolean> {
    if (isInCurrentWorkspace(workspacePath)) return true;

    const openHere: vscode.MessageItem = { title: l10n.t('Open Folder') };
    const openNew: vscode.MessageItem = { title: l10n.t('Open in New Window') };

    const choice = await vscode.window.showWarningMessage(
        l10n.t("The migration project is located in '{path}', which isn't part of the current workspace.", {
            path: workspacePath,
        }),
        { modal: true },
        openHere,
        openNew,
    );

    if (!choice) return false;

    const forceNewWindow = choice === openNew;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), { forceNewWindow });
    return false;
}

/**
 * Given a filesystem path that is inside (or equal to) a `.cosmosdb-migration`
 * folder, returns the workspace root (the parent of that folder), or `undefined`
 * if no such segment exists.
 *
 * Walks up via `path.dirname` so ancestor directories that merely contain the
 * folder name as a substring (e.g. `/foo/my-.cosmosdb-migration-bak/file`) do
 * not produce false matches — only exact path segments are matched.
 */
function resolveWorkspaceFromMigrationUri(fsPath: string): string | undefined {
    let current = fsPath;
    while (true) {
        if (path.basename(current) === MIGRATION_FOLDER) {
            return path.dirname(current);
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

export async function openExistingMigration(
    _context: IActionContext,
    node?: MigrationItem | vscode.Uri,
): Promise<void> {
    if (!node) {
        return;
    }

    if (node instanceof vscode.Uri) {
        const workspacePath = resolveWorkspaceFromMigrationUri(node.fsPath);
        if (!workspacePath) {
            return;
        }
        if (!(await ensureWorkspaceOrPrompt(workspacePath))) return;
        MigrationAssistantTab.render(workspacePath);
        return;
    }

    if (!(await ensureWorkspaceOrPrompt(node.model.migrationPath))) return;
    MigrationAssistantTab.render(node.model.migrationPath);
}
