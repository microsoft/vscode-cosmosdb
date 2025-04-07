/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { StorageNames, StorageService } from '../../services/storageService';
import { CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { AttachedAccountSuffix } from '../../tree/v1-legacy-api/AttachedAccountsTreeItem';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickWorkspaceResource } from '../../utils/pickItem/pickAppResource';

export async function removeConnectionV1(context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    const cosmosDBTopLevelContextValues: string[] = [PostgresServerTreeItem.contextValue];

    const children = await ext.attachedAccountsNode.loadAllChildren(context);
    if (children.length < 2) {
        const message = l10n.t('There are no Attached Accounts.');
        void vscode.window.showInformationMessage(message);
    } else {
        if (!node) {
            node = await ext.rgApi.workspaceResourceTree.showTreeItemPicker<AzExtTreeItem>(
                cosmosDBTopLevelContextValues.map((val: string) => (val += AttachedAccountSuffix)),
                context,
            );
        }

        if (!node) {
            return undefined;
        }

        await ext.attachedAccountsNode.detach(node);
        await ext.rgApi.workspaceResourceTree.refresh(context, ext.attachedAccountsNode);
    }
}

export async function removeAzureConnection(
    context: IActionContext,
    node?: CosmosDBAccountResourceItemBase | ClusterItemBase,
): Promise<void> {
    if (!node) {
        node = await pickWorkspaceResource<CosmosDBAccountResourceItemBase | ClusterItemBase>(context, {
            type: [WorkspaceResourceType.AttachedAccounts, WorkspaceResourceType.MongoClusters],
            expectedChildContextValue: ['treeItem.account', 'treeItem.mongoCluster'],
        });
    }

    if (!node) {
        return;
    }

    await removeConnection(context, node);
}

export async function removeConnection(
    context: IActionContext,
    node: CosmosDBAccountResourceItemBase | ClusterItemBase,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    // ask for confirmation

    /**
     * Initial attempt with node.getTreeItem() and then accessing the label has failed, fell free to fix.
     * This solution below was quicker to implement and works just as well.
     */

    let connectionName: string;
    if (node instanceof ClusterItemBase) {
        connectionName = node.cluster.name;
    } else if (node instanceof CosmosDBAccountResourceItemBase) {
        connectionName = node.account.name;
    } else {
        connectionName = 'unknown';
    }

    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Are you sure?'),
        l10n.t('Delete "{connectionName}"?', { connectionName }) + '\n' + l10n.t('This cannot be undone.'),
        'delete',
    );

    if (!confirmed) {
        return;
    }

    // continue with deletion

    if (node instanceof ClusterItemBase) {
        await ext.state.showDeleting(node.id, async () => {
            await StorageService.get(StorageNames.Workspace).delete(WorkspaceResourceType.MongoClusters, node.id);
        });

        ext.mongoClustersWorkspaceBranchDataProvider.refresh();
    }

    if (node instanceof CosmosDBAccountResourceItemBase) {
        await ext.state.showDeleting(node.id, async () => {
            await StorageService.get(StorageNames.Workspace).delete(WorkspaceResourceType.AttachedAccounts, node.id);
        });

        ext.cosmosDBWorkspaceBranchDataProvider.refresh();
    }

    showConfirmationAsInSettings(l10n.t('The selected connection has been removed from your workspace.'));
}
