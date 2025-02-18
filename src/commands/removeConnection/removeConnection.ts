/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { MongoClusterItemBase } from '../../mongoClusters/tree/MongoClusterItemBase';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { AttachedAccountSuffix } from '../../tree/AttachedAccountsTreeItem';
import { CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../tree/workspace-api/SharedWorkspaceStorage';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { pickWorkspaceResource } from '../../utils/pickItem/pickAppResource';

export async function removeConnectionV1(context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    const cosmosDBTopLevelContextValues: string[] = [PostgresServerTreeItem.contextValue];

    const children = await ext.attachedAccountsNode.loadAllChildren(context);
    if (children.length < 2) {
        const message = localize('noAttachedAccounts', 'There are no Attached Accounts.');
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
    node?: CosmosDBAccountResourceItemBase | MongoClusterItemBase,
): Promise<void> {
    if (!node) {
        node = await pickWorkspaceResource<CosmosDBAccountResourceItemBase | MongoClusterItemBase>(context, {
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
    node: CosmosDBAccountResourceItemBase | MongoClusterItemBase,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    if (node instanceof MongoClusterItemBase) {
        await ext.state.showDeleting(node.id, async () => {
            await SharedWorkspaceStorage.delete(WorkspaceResourceType.MongoClusters, node.id);
        });

        ext.mongoClustersWorkspaceBranchDataProvider.refresh();
    }

    if (node instanceof CosmosDBAccountResourceItemBase) {
        await ext.state.showDeleting(node.id, async () => {
            await SharedWorkspaceStorage.delete(WorkspaceResourceType.AttachedAccounts, node.id);
        });

        ext.cosmosDBWorkspaceBranchDataProvider.refresh();
    }

    showConfirmationAsInSettings(
        localize(
            'showConfirmation.removedWorkspaceConnection',
            'The selected connection has been removed from your workspace.',
        ),
    );
}
