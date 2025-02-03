/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { setConnectedNode } from '../../mongo/setConnectedNode';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoClusterItemBase } from '../../mongoClusters/tree/MongoClusterItemBase';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { AttachedAccountSuffix } from '../../tree/AttachedAccountsTreeItem';
import { CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';
import { WorkspaceResourceType } from '../../tree/workspace/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../tree/workspace/SharedWorkspaceStorage';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { pickWorkspaceResource } from '../../utils/pickItem/pickAppResource';

export async function detachDatabaseAccountV1(context: IActionContext, node?: AzExtTreeItem): Promise<void> {
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

        if (node instanceof MongoAccountTreeItem) {
            if (ext.connectedMongoDB && node.fullId === ext.connectedMongoDB.parent.fullId) {
                setConnectedNode(undefined);
                await node.refresh(context);
            }
        }
        await ext.attachedAccountsNode.detach(node);
        await ext.rgApi.workspaceResourceTree.refresh(context, ext.attachedAccountsNode);
    }
}

export async function detachAzureDatabaseAccount(
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

    await detachDatabaseAccount(context, node);
}

export async function detachDatabaseAccount(
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
