/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { StorageNames, StorageService } from '../../services/StorageService';
import { type CosmosDBAccountAttachedResourceItem } from '../../tree/cosmosdb/CosmosDBAccountAttachedResourceItem';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickWorkspaceResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBRemoveConnection(
    context: IActionContext,
    node?: CosmosDBAccountAttachedResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickWorkspaceResource<CosmosDBAccountAttachedResourceItem>(context, {
            type: [WorkspaceResourceType.AttachedAccounts],
            expectedChildContextValue: ['treeItem.account'],
        });
    }

    if (!node) {
        return;
    }

    context.telemetry.properties.experience = node.experience.api;
    let confirmed = false;
    const connectionName = node.account.name;
    const storageType = WorkspaceResourceType.AttachedAccounts;
    const refreshProvider = ext.cosmosDBWorkspaceBranchDataProvider;

    await ext.state.showDeleting(node.id, async () => {
        // ask for confirmation
        confirmed = await getConfirmationAsInSettings(
            l10n.t('Are you sure?'),
            l10n.t('Delete "{connectionName}"?', { connectionName }) + '\n' + l10n.t('This cannot be undone.'),
            'delete',
        );

        if (confirmed) {
            const resourceId = node.storageId;
            await StorageService.get(StorageNames.Workspace).delete(storageType, resourceId);
            showConfirmationAsInSettings(l10n.t('The selected connection has been removed from your workspace.'));
        }
        refreshProvider.refresh();
    });
    if (!confirmed) {
        throw new UserCancelledError();
    }
}
