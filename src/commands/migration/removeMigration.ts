/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { StorageNames, StorageService } from '../../services/StorageService';
import { type MigrationItem } from '../../tree/workspace-view/migration/MigrationItem';
import { MIGRATIONS_STORAGE_KEY } from '../../tree/workspace-view/migration/MigrationWorkspaceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function removeMigration(_context: IActionContext, node?: MigrationItem): Promise<void> {
    if (!node) {
        return;
    }

    let confirmed = false;
    const migrationName = node.model.name;

    await ext.state.showDeleting(node.id, async () => {
        confirmed = await getConfirmationAsInSettings(
            l10n.t('Are you sure?'),
            l10n.t('Remove migration "{migrationName}" from the workspace?', { migrationName }) +
                '\n' +
                l10n.t('The migration files on disk will not be deleted.'),
            'delete',
        );

        if (confirmed) {
            await StorageService.get(StorageNames.Workspace).delete(MIGRATIONS_STORAGE_KEY, node.model.storageId);
            showConfirmationAsInSettings(l10n.t('The migration has been removed from your workspace.'));
        }
        ext.migrationWorkspaceBranchDataProvider.refresh();
    });

    if (!confirmed) {
        throw new UserCancelledError();
    }
}
