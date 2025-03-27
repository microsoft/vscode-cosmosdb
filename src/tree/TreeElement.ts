/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementWithId } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';

export interface ExtTreeElementBase extends TreeElementWithId {
    getChildren?(): vscode.ProviderResult<ExtTreeElementBase[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}

export type TreeElement = ExtTreeElementBase;
