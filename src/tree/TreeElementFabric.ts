/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type FabricTreeNode,
    type IFabricTreeNodeProvider,
    type ILocalProjectTreeNodeProvider,
} from '@microsoft/vscode-fabric-api';

/**
 * NOTE: At this moment the fabric extension API does not provide a way to associate a data provider with a tree node.
 * This interface extends FabricTreeNode to include a dataProvider property for our internal use.
 * However, we still can't manipulate the Tree views provided by the fabric extension API directly.
 * No updates, deletions, or additions of nodes can be done programmatically at this time from our side.
 * This interface is prepared for future use when such capabilities are made available by the fabric extension API.
 */
export interface TreeElementFabric extends FabricTreeNode {
    id: string;
    dataProvider: IFabricTreeNodeProvider | ILocalProjectTreeNodeProvider;
}
