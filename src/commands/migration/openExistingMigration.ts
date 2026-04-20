/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as path from 'path';
import * as vscode from 'vscode';
import { MigrationAssistantTab } from '../../panels/MigrationAssistantTab';
import { MIGRATION_FOLDER } from '../../services/MigrationProjectService';
import { type MigrationItem } from '../../tree/workspace-view/migration/MigrationItem';

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
        MigrationAssistantTab.render(workspacePath);
        return;
    }

    MigrationAssistantTab.render(node.model.migrationPath);
}
