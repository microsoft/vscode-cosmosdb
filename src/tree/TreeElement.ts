/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementWithId } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';

export interface TreeElement extends TreeElementWithId {
    getChildren?(): vscode.ProviderResult<TreeElement[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
    dataProvider?: vscode.TreeDataProvider<TreeElement>; // Optional, each data provider should set this property by itself
}
