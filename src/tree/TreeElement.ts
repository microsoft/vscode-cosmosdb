/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementWithId } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';

export interface ExtTreeElementBase extends TreeElementWithId {
    getChildren?(): vscode.ProviderResult<ExtTreeElementBase[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;

    /**
     * Optional method to return the parent of Tree Element / Item.
     * Return `null` or `undefined` in case of a child of root.
     *
     * **NOTE:** This method should be implemented in order to use the {@link TreeView.reveal reveal} API
     *           implemented in branch data providers.
     *
     * @returns Parent of the tree item / tree element.
     */
    getParent?(): ExtTreeElementBase | undefined | null;
}

export type TreeElement = ExtTreeElementBase;
