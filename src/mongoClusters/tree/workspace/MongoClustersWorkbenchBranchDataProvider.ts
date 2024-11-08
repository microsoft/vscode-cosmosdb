/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type WorkspaceResourceBranchDataProvider } from '@microsoft/vscode-azureresources-api';
import { type ProviderResult, type TreeItem } from 'vscode';
import { MongoDBAccountsItem } from './MongoDBAccountsWorkspaceItem';

export class MongoClustersWorkspaceBranchDataProvider implements WorkspaceResourceBranchDataProvider<TreeElementBase> {
    getChildren(element: TreeElementBase): ProviderResult<TreeElementBase[]> {
        return element.getChildren?.() ?? [];
    }
    getResourceItem(): TreeElementBase | Thenable<TreeElementBase> {
        return new MongoDBAccountsItem();
    }

    getTreeItem(element: TreeElementBase): TreeItem | Thenable<TreeItem> {
        return element.getTreeItem();
    }
}
