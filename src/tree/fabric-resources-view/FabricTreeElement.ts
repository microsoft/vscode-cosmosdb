/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FabricTreeNode } from '@microsoft/vscode-fabric-api';
import type vscode from 'vscode';
import { type TreeElement } from '../TreeElement';

export interface FabricTreeElement extends vscode.TreeItem, TreeElement {
    id: string;

    getChildNodes(): Promise<FabricTreeNode[]>; // Fabric specific method
}
