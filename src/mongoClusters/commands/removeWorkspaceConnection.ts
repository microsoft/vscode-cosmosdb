/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace/sharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../tree/workspace/sharedWorkspaceStorage';
import { type MongoClusterWorkspaceItem } from '../tree/workspace/MongoClusterWorkspaceItem';

export async function removeWorkspaceConnection(
    _context: IActionContext,
    node: MongoClusterWorkspaceItem,
): Promise<void> {
    await ext.state.showDeleting(node.id, async () => {
        await SharedWorkspaceStorage.delete(WorkspaceResourceType.MongoClusters, node.id);
    });

    ext.mongoClustersWorkspaceBranchDataProvider.refresh();
}
