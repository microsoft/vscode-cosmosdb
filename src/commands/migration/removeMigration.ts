/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { type MigrationItem } from '../../tree/workspace-view/migration/MigrationItem';
import { MigrationWorkspaceItem } from '../../tree/workspace-view/migration/MigrationWorkspaceItem';
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
            await MigrationWorkspaceItem.removeMigration(node.model.storageId);
            showConfirmationAsInSettings(l10n.t('The migration has been removed from your workspace.'));
        }
    });

    if (!confirmed) {
        throw new UserCancelledError();
    }
}
